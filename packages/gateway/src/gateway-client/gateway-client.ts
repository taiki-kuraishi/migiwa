import { Result } from "better-result";
import {
  APIVersion,
  GatewayCloseCodes,
  GatewayDispatchEvents,
  GatewayOpcodes,
  type GatewayDispatchPayload,
  type GatewayReceivePayload,
  type GatewaySendPayload,
} from "discord-api-types/v10";

import type { Connection, GatewayState } from "./types";

import { newSessionCloseCodes, resumableCloseCode, stopCloseCodes } from "./constants";
import { GatewayPayloadParseError } from "./errors";

/**
 * Discord Gateway の接続を進める状態機械。socket・timer・永続化は持たず、Durable Object が入力
 * method を呼び、返った出力を順に実行する。
 * 1 つの入力が送信と heartbeat の予約のように複数の出力を生むことがあるので、入力 method はすべて
 * 出力の配列を返す（出力が無ければ空配列）。
 * IDENTIFY は bot token と intents で新しい session を始めるログインで、取りこぼした event は戻らない。
 * RESUME は切れた session を session ID と sequence で再開し、切れている間の event を受け直す。
 */
export class GatewayClient {
  private readonly token: string;
  private readonly intents: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private persistent: GatewayState;
  // "connecting" は reconnect を出してから connected() までの間。open できなかった socket の close も
  // 受け取るために区別する。null は socket を待っていない状態で、遅れて届いた入力は捨てる。
  private connection: Connection | "connecting" | null = null;

  /**
   * Bot token・intents・永続状態を受け取り、まだ socket の無い状態で作る。
   */
  public constructor(args: {
    token: string;
    intents: number;
    state: GatewayState;
    now?: () => number;
    random?: () => number;
  }) {
    this.token = args.token;
    this.intents = args.intents;
    this.persistent = { ...args.state };
    this.now = args.now ?? Date.now;
    this.random = args.random ?? Math.random;
  }

  /**
   * Durable Object が入力のたびに保存する永続状態の複製を返す。
   */
  public get state() {
    return { ...this.persistent };
  }

  /**
   * Durable Object の起動後、最初の接続を開く。
   * 1. すぐに再接続する: session を保存していれば resume URL へ RESUME、無ければ gateway URL へ
   *    IDENTIFY（新しい session を始める）
   */
  public start() {
    // Step 1: すぐに再接続する: session を保存していれば resume URL へ RESUME、無ければ gateway URL へ
    // IDENTIFY（新しい session を始める）
    return [this.reconnect({ at: this.now(), resume: true })];
  }

  /**
   * 開いた socket を追跡し始める。
   * 1. HELLO が間隔を渡すまで heartbeat なしで追跡する
   */
  public connected() {
    // Step 1: HELLO が間隔を渡すまで heartbeat なしで追跡する
    this.connection = { heartbeatInterval: null, acked: true };
    return [];
  }

  /**
   * 開いている socket から届いた text frame を処理する。
   * 1. socket が open していなければ frame を捨てる
   * 2. frame を payload として読めなければ close して RESUME する
   * 3. opcode で分岐する
   */
  public received(text: string) {
    // Step 1: socket が open していなければ frame を捨てる
    if (this.connection === null || this.connection === "connecting") {
      return [];
    }

    // Step 2: frame を payload として読めなければ close して RESUME する
    const payload = this.parse(text);

    if (payload.isErr()) {
      return this.closeAndReconnect({ at: this.now(), resume: true });
    }

    // Step 3: opcode で分岐する
    return this.handle({ connection: this.connection, payload: payload.value });
  }

  /**
   * Socket が閉じた、または open できなかった後の進め方を決める。
   * 1. socket を待っていなければ close を無視する
   * 2. 閉じた socket を忘れる
   * 3. Discord が再接続不可とする close code なら止まる
   * 4. それ以外はすぐに再接続する: 4007 invalid seq と 4009 session timed out は新しい session を
   *    IDENTIFY、ほかの code は RESUME
   */
  public disconnected(code: number) {
    // Step 1: socket を待っていなければ close を無視する
    if (this.connection === null) {
      return [];
    }

    // Step 2: 閉じた socket を忘れる
    this.connection = null;

    // Step 3: Discord が再接続不可とする close code なら止まる
    if (stopCloseCodes.has(code)) {
      return [{ type: "stop", reason: `${GatewayCloseCodes[code]} (${code})` } as const];
    }

    // Step 4: それ以外はすぐに再接続する: 4007 invalid seq と 4009 session timed out は新しい session を
    // IDENTIFY、ほかの code は RESUME
    return [this.reconnect({ at: this.now(), resume: !newSessionCloseCodes.has(code) })];
  }

  /**
   * 時刻になった heartbeat を送る。
   * 1. socket が open していない、または HELLO の前なら何もしない
   * 2. 直前の heartbeat に ACK が無ければ close して RESUME する
   * 3. 最後の sequence を heartbeat で送り、1 間隔後に次の heartbeat を予約する
   */
  public heartbeatDue() {
    // Step 1: socket が open していない、または HELLO の前なら何もしない
    if (
      this.connection === null ||
      this.connection === "connecting" ||
      this.connection.heartbeatInterval === null
    ) {
      return [];
    }

    // Step 2: 直前の heartbeat に ACK が無ければ close して RESUME する
    if (!this.connection.acked) {
      return this.closeAndReconnect({ at: this.now(), resume: true });
    }

    // Step 3: 最後の sequence を heartbeat で送り、1 間隔後に次の heartbeat を予約する
    this.connection.acked = false;
    return [
      this.send({ op: GatewayOpcodes.Heartbeat, d: this.persistent.sequence }),
      { type: "scheduleHeartbeat", at: this.now() + this.connection.heartbeatInterval } as const,
    ];
  }

  /**
   * 受け取った payload を opcode で振り分ける。
   * 1. HELLO: IDENTIFY か RESUME を送り、jitter を掛けた間隔の後に最初の heartbeat を予約する
   * 2. heartbeat 要求: すぐに heartbeat を送る
   * 3. heartbeat ACK: 直前の heartbeat を ACK 済みにする
   * 4. op 7 reconnect: close してすぐに RESUME する
   * 5. op 9 invalid session: close し、1〜5 秒後に再接続する。RESUME するのは d が true のときだけ
   * 6. dispatch: sequence と、READY なら session も保存し、event を渡す
   * 7. それ以外の opcode: 無視する
   */
  private handle(args: { connection: Connection; payload: GatewayReceivePayload }) {
    const { connection, payload } = args;
    switch (payload.op) {
      case GatewayOpcodes.Hello: {
        // Step 1: HELLO: IDENTIFY か RESUME を送り、jitter を掛けた間隔の後に最初の heartbeat を予約する
        return this.hello({ connection, heartbeatInterval: payload.d.heartbeat_interval });
      }

      case GatewayOpcodes.Heartbeat: {
        // Step 2: heartbeat 要求: すぐに heartbeat を送る
        return [this.send({ op: GatewayOpcodes.Heartbeat, d: this.persistent.sequence })];
      }

      case GatewayOpcodes.HeartbeatAck: {
        // Step 3: heartbeat ACK: 直前の heartbeat を ACK 済みにする
        connection.acked = true;
        return [];
      }

      case GatewayOpcodes.Reconnect: {
        // Step 4: op 7 reconnect: close してすぐに RESUME する
        return this.closeAndReconnect({ at: this.now(), resume: true });
      }

      case GatewayOpcodes.InvalidSession: {
        // Step 5: op 9 invalid session: close し、1〜5 秒後に再接続する。RESUME するのは d が true の
        // ときだけ
        return this.closeAndReconnect({
          at: this.now() + 1000 + this.random() * 4000,
          resume: payload.d,
        });
      }

      case GatewayOpcodes.Dispatch: {
        // Step 6: dispatch: sequence と、READY なら session も保存し、event を渡す
        return this.dispatch(payload);
      }

      default: {
        // Step 7: それ以外の opcode: 無視する
        return [];
      }
    }
  }

  /**
   * HELLO を受けて handshake を始める。
   * 1. HELLO の間隔を socket に記録し、ACK 済みから数え始める
   * 2. IDENTIFY か RESUME を送り、間隔に 0〜1 の jitter を掛けた後に最初の heartbeat を予約する
   */
  private hello(args: { connection: Connection; heartbeatInterval: number }) {
    // Step 1: HELLO の間隔を socket に記録し、ACK 済みから数え始める
    args.connection.heartbeatInterval = args.heartbeatInterval;
    args.connection.acked = true;

    // Step 2: IDENTIFY か RESUME を送り、間隔に 0〜1 の jitter を掛けた後に最初の heartbeat を予約する
    return [
      this.handshake(),
      {
        type: "scheduleHeartbeat",
        at: this.now() + args.heartbeatInterval * this.random(),
      } as const,
    ];
  }

  /**
   * HELLO の後に送る最初の payload を作る。
   * 1. session ID と sequence を保存していれば RESUME を送る
   * 2. 無ければ IDENTIFY を送り、新しい session を始める
   */
  private handshake() {
    const { sessionId, sequence } = this.persistent;

    // Step 1: session ID と sequence を保存していれば RESUME を送る
    if (sessionId !== null && sequence !== null) {
      return this.send({
        op: GatewayOpcodes.Resume,
        d: { token: this.token, session_id: sessionId, seq: sequence },
      });
    }

    // Step 2: 無ければ IDENTIFY を送り、新しい session を始める
    return this.send({
      op: GatewayOpcodes.Identify,
      d: {
        token: this.token,
        intents: this.intents,
        properties: { os: "linux", browser: "migiwa", device: "migiwa" },
      },
    });
  }

  /**
   * Dispatch を記録して event を渡す。
   * 1. sequence を保存する
   * 2. READY なら session ID と resume URL も保存する
   * 3. event を渡す
   */
  private dispatch(payload: GatewayDispatchPayload) {
    // Step 1: sequence を保存する
    this.persistent.sequence = payload.s;

    // Step 2: READY なら session ID と resume URL も保存する
    if (payload.t === GatewayDispatchEvents.Ready) {
      this.persistent.sessionId = payload.d.session_id;
      this.persistent.resumeUrl = payload.d.resume_gateway_url;
    }

    // Step 3: event を渡す
    return [
      {
        type: "dispatch",
        event: {
          type: payload.t,
          sequence: payload.s,
          sessionId: this.persistent.sessionId,
          data: payload.d,
        },
      } as const,
    ];
  }

  /**
   * 今の socket を session を残したまま閉じ、再接続を出す。
   */
  private closeAndReconnect(args: { at: number; resume: boolean }) {
    return [{ type: "disconnect", code: resumableCloseCode } as const, this.reconnect(args)];
  }

  /**
   * 再接続の出力を作り、新しい socket を待つ状態にする。
   * 1. 新しい socket を待つ状態にする
   * 2. RESUME を求められ、session と resume URL があれば resume URL へ RESUME で再接続する
   * 3. それ以外は session を捨て、gateway URL へ IDENTIFY で再接続する
   */
  private reconnect(args: { at: number; resume: boolean }) {
    const { sessionId, sequence, resumeUrl, gatewayUrl } = this.persistent;

    // Step 1: 新しい socket を待つ状態にする
    this.connection = "connecting";

    // Step 2: RESUME を求められ、session と resume URL があれば resume URL へ RESUME で再接続する
    if (args.resume && sessionId !== null && sequence !== null && resumeUrl !== null) {
      return {
        type: "reconnect",
        at: args.at,
        url: this.connectUrl(resumeUrl),
        resume: true,
      } as const;
    }

    // Step 3: それ以外は session を捨て、gateway URL へ IDENTIFY で再接続する
    this.persistent = { sessionId: null, sequence: null, resumeUrl: null, gatewayUrl };
    return {
      type: "reconnect",
      at: args.at,
      url: this.connectUrl(gatewayUrl),
      resume: false,
    } as const;
  }

  /**
   * 接続先の URL に API version と encoding の query を付ける。
   */
  private connectUrl(base: string) {
    const url = new URL(base);
    url.searchParams.set("v", APIVersion);
    url.searchParams.set("encoding", "json");
    return url.toString();
  }

  /**
   * Text frame を payload として読む。
   * 1. JSON として読めなければ GatewayPayloadParseError を返す
   * 2. 数値の op を持つ object でなければ GatewayPayloadParseError を返す
   * 3. payload を返す
   */
  private parse(text: string) {
    return Result.gen(function* () {
      // Step 1: JSON として読めなければ GatewayPayloadParseError を返す
      const value = yield* Result.try({
        try: (): unknown => JSON.parse(text),
        catch: (cause) =>
          new GatewayPayloadParseError({ cause, message: "Gateway frame is not valid JSON" }),
      });

      // Step 2: 数値の op を持つ object でなければ GatewayPayloadParseError を返す
      if (!this.isPayload(value)) {
        return Result.err(
          new GatewayPayloadParseError({
            cause: value,
            message: "Gateway frame has no numeric op",
          }),
        );
      }

      // Step 3: payload を返す
      return Result.ok(value);
    }, this);
  }

  /**
   * JSON の値が数値の op を持つ object かを確かめる。op ごとの d の形は Discord の仕様を信頼して
   * 確かめない。
   */
  private isPayload(value: unknown): value is GatewayReceivePayload {
    return (
      typeof value === "object" && value !== null && "op" in value && typeof value.op === "number"
    );
  }

  /**
   * 送信する payload を出力の形にする。
   */
  private send(payload: GatewaySendPayload) {
    return { type: "send", payload } as const;
  }
}
