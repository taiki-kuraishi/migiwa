import { Result } from "better-result";

import type { DispatchEvent } from "./types";

import { sendTimeout, userIdPaths } from "./constants";
import { EventRecordInvalidError, EventSendError } from "./errors";

/**
 * Dispatch を Basin の stream（infra/cloudflare の migiwa_events_v1）へ送る。
 */
export class EventStreamClient {
  private readonly stream: Cloudflare.Env["EVENTS"];

  /**
   * Pipelines の binding を受け取る。
   */
  public constructor(args: { stream: Cloudflare.Env["EVENTS"] }) {
    this.stream = args.stream;
  }

  /**
   * Dispatch を 1 行の record にして stream に送る。
   * 1. 必須の列が欠けていれば送らずに EventRecordInvalidError を返す
   * 2. Record を作って stream に送る。失敗するか sendTimeout を過ぎれば EventSendError を返す
   */
  public async send(args: { receivedAt: number; event: DispatchEvent }) {
    return Result.gen(async function* () {
      // Step 1: 必須の列が欠けていれば送らずに EventRecordInvalidError を返す
      // Pipelines は schema に合わない record を受け取った後で黙って捨てるので、送る前に弾いてログに残す。
      const missing = this.missingColumns(args);

      if (missing.length > 0) {
        return Result.err(
          new EventRecordInvalidError({
            columns: missing,
            message: `Dispatch ${args.event.type} lacks required columns`,
          }),
        );
      }

      // Step 2: Record を作って stream に送る。失敗するか sendTimeout を過ぎれば EventSendError を返す
      // 上限を過ぎたら結果を待つのをやめてログに残すだけで、stream.send は取り消せない。送信は遅れて
      // 成功しうるので、ここで失敗とした record も Basin に入っていることがある。
      yield* await Result.tryPromise({
        try: async () => Promise.race([this.stream.send([this.toRecord(args)]), this.timeout()]),
        catch: (cause) =>
          new EventSendError({ cause, message: `Failed to send dispatch ${args.event.type}` }),
      });
      return Result.ok(undefined);
    }, this);
  }

  /**
   * 送信を待つ上限の sendTimeout が過ぎたら reject する。
   */
  // 必ず throw するので never を書く。導出に任せると void になり、race の結果に混ざる。
  private async timeout(): Promise<never> {
    await scheduler.wait(sendTimeout);
    throw new Error(`The stream did not accept the record within ${sendTimeout} ms`);
  }

  /**
   * Stream の schema で required の列のうち、値が欠けている列の名前を返す。
   */
  private missingColumns(args: { receivedAt: number; event: DispatchEvent }) {
    // GatewayClient は frame の op しか確かめないので、t・d・READY の session_id は型どおりとは限らない。
    const type: unknown = args.event.type;
    const sessionId: unknown = args.event.sessionId;
    const payload: unknown = args.event.data;
    const present = {
      received_at: Number.isFinite(args.receivedAt),
      type: typeof type === "string" && type !== "",
      session_id: typeof sessionId === "string" && sessionId !== "",
      payload: typeof payload === "object" && payload !== null,
    };
    return Object.entries(present)
      .filter(([, value]) => !value)
      .map(([column]) => column);
  }

  /**
   * Dispatch を stream の列に並べる。
   */
  private toRecord(args: { receivedAt: number; event: DispatchEvent }) {
    const { event } = args;
    return {
      received_at: args.receivedAt,
      type: event.type,
      session_id: event.sessionId,
      seq: event.sequence,
      guild_id: this.guildId(event),
      channel_id: this.channelId(event),
      user_id: this.userId(event),
      payload: event.data,
    };
  }

  /**
   * Event の guild の ID を返す。
   * 1. data.guild_id があればそれを返す
   * 2. GUILD_* の event なら data.id を返す（GUILD_CREATE などは guild そのものが data）
   */
  private guildId(event: DispatchEvent) {
    const guildId = this.stringAt({ value: event.data, path: ["guild_id"] });

    // Step 1: data.guild_id があればそれを返す
    if (guildId !== null) {
      return guildId;
    }

    // Step 2: GUILD_* の event なら data.id を返す（GUILD_CREATE などは guild そのものが data）
    if (!event.type.startsWith("GUILD_")) {
      return null;
    }
    return this.stringAt({ value: event.data, path: ["id"] });
  }

  /**
   * Event の channel の ID を返す。
   * 1. data.channel_id があればそれを返す
   * 2. CHANNEL_*・THREAD_* の event なら data.id を返す（channel や thread そのものが data）
   */
  private channelId(event: DispatchEvent) {
    const channelId = this.stringAt({ value: event.data, path: ["channel_id"] });

    // Step 1: data.channel_id があればそれを返す
    if (channelId !== null) {
      return channelId;
    }

    // Step 2: CHANNEL_*・THREAD_* の event なら data.id を返す（channel や thread そのものが data）
    if (!event.type.startsWith("CHANNEL_") && !event.type.startsWith("THREAD_")) {
      return null;
    }
    return this.stringAt({ value: event.data, path: ["id"] });
  }

  /**
   * Event の user の ID を、userIdPaths の順で最初に見つかったものを返す。
   */
  private userId(event: DispatchEvent) {
    for (const path of userIdPaths) {
      const userId = this.stringAt({ value: event.data, path });

      if (userId !== null) {
        return userId;
      }
    }
    return null;
  }

  /**
   * Object を path の key の順にたどり、行き着いた値が文字列ならそれを、無ければ null を返す。
   * 1. 途中の値が object でなければ（配列も含む）null を返す
   * 2. 行き着いた値が文字列でなければ null を返す
   * 3. 文字列を返す
   */
  private stringAt(args: { value: unknown; path: string[] }) {
    let { value } = args;
    for (const key of args.path) {
      // Step 1: 途中の値が object でなければ（配列も含む）null を返す
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
      }
      value = Reflect.get(value, key);
    }

    // Step 2: 行き着いた値が文字列でなければ null を返す
    if (typeof value !== "string") {
      return null;
    }

    // Step 3: 文字列を返す
    return value;
  }
}
