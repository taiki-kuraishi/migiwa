import type { GatewayOutput } from "@migiwa/gateway";

import { GatewayClient } from "@migiwa/gateway";
import { DurableObject } from "cloudflare:workers";
import { GatewayDispatchEvents, GatewayOpcodes } from "discord-api-types/v10";

import { BotTokenClient } from "../client/bot-token-client";
import { DiscordClient } from "../client/discord-client";
import { EventStreamClient } from "../client/event-stream-client";
import { GatewaySocketClient } from "../client/gateway-socket-client";
import { GatewayStateRepository } from "../repository/gateway-state-repository";
import { PrepareGatewayUseCase } from "../use-case/prepare-gateway-use-case";
import { abnormalCloseCode, helloTimeout, resumableCloseCode } from "./constants";

/**
 * Discord Gateway に常時繋ぎ、受けた dispatch を Basin の stream に送る。GatewayClient に socket と
 * alarm の出来事を入力として渡し、返った出力を実行する。
 */
export class BotObject extends DurableObject {
  private readonly gatewayStates: GatewayStateRepository;
  private readonly botToken: BotTokenClient;
  private readonly sockets: GatewaySocketClient;
  private readonly events: EventStreamClient;
  // ここから下はメモリにだけ持つ。outbound の socket は DO の作り直しを越えられないので、作り直された
  // DO は storage の session から RESUME し直す。
  private gateway: GatewayClient | null = null;
  private starting: Promise<void> | null = null;
  private socket: WebSocket | null = null;
  private phase: "idle" | "connecting" | "connected" | "stopped" = "idle";
  private lastReceivedAt: number | null = null;
  private heartbeatAt: number | null = null;
  private reconnectTarget: { at: number; url: string } | null = null;
  // Upgrade が通っても HELLO が来なければ、heartbeat の期限も置かれず alarm が止まる。その socket を
  // 見限る期限を持ち、cron が alarm を掛け直すだけでは抜けられない状態を作らない。
  private helloDeadline: { at: number; socket: WebSocket } | null = null;
  // 出力は入力の順に 1 つずつ実行する。順が入れ違うと、close した後の socket に heartbeat を送るといった
  // ことが起きる。
  private outputs: Promise<void> = Promise.resolve();

  /**
   * Gateway の状態の storage と、bot token・Gateway・Basin の client を用意する。Discord の REST client
   * は bot token を読んでから start() で作る。
   */
  public constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.gatewayStates = new GatewayStateRepository({ storage: ctx.storage.kv });
    this.botToken = new BotTokenClient({ secret: env.DISCORD_BOT_TOKEN });
    this.sockets = new GatewaySocketClient();
    this.events = new EventStreamClient({ stream: env.EVENTS });
  }

  /**
   * 接続の状態、保存した session の有無、Discord から最後に frame を受けた時刻を返す。
   */
  public status() {
    const stored = this.gatewayStates.find();
    return {
      state: this.phase,
      hasSession: stored.isOk() && stored.value !== undefined && stored.value.sessionId !== null,
      lastReceivedAt: this.lastReceivedAt,
    };
  }

  /**
   * Gateway への接続が動いていることを保証する。cron が 1 分ごとに呼ぶ。
   * 1. 止まっていれば何もしない。止まったことはメモリにしか持たないので、DO が作り直される（deploy か
   *    eviction）までで、作り直された後は次の cron が繋ぎ直す
   * 2. 接続を始めていれば alarm を掛け直す。alarm の連鎖が切れていても、次の期限から回り出す
   * 3. 始めていなければ接続を始める。重なった呼び出しは 1 回の開始を待つ
   */
  public async ensureConnected() {
    // Step 1: 止まっていれば何もしない。止まったことはメモリにしか持たないので、DO が作り直される（deploy
    // か eviction）までで、作り直された後は次の cron が繋ぎ直す
    if (this.phase === "stopped") {
      return;
    }

    // Step 2: 接続を始めていれば alarm を掛け直す。alarm の連鎖が切れていても、次の期限から回り出す
    if (this.gateway !== null) {
      await this.scheduleAlarm();
      return;
    }

    // Step 3: 始めていなければ接続を始める。重なった呼び出しは 1 回の開始を待つ
    this.starting ??= this.start().finally(() => {
      this.starting = null;
    });
    await this.starting;
  }

  /**
   * 期限の来たものを実行し、残った期限で alarm を掛け直す。
   * 1. Gateway client が無ければ（DO が作り直された）接続を始める
   * 2. 期限の来た HELLO 待ち・再接続・heartbeat を実行する
   * 3. 残った期限で alarm を掛け直す
   */
  public override async alarm() {
    // Step 1: Gateway client が無ければ（DO が作り直された）接続を始める
    if (this.gateway === null) {
      await this.ensureConnected();
      return;
    }

    // Step 2: 期限の来た HELLO 待ち・再接続・heartbeat を実行する
    await this.runDue({ gateway: this.gateway, now: Date.now() });

    // Step 3: 残った期限で alarm を掛け直す
    await this.scheduleAlarm();
  }

  /**
   * Bot token を読み、Gateway への接続を始める。
   * 1. Bot token を読めなければログに残し、次の cron で始め直す
   * 2. 読めた token で接続を始める
   */
  private async start() {
    const token = await this.botToken.get();

    // Step 1: Bot token を読めなければログに残し、次の cron で始め直す
    if (token.isErr()) {
      console.error({ message: "Failed to read the bot token", error: token.error.toJSON() });
      return;
    }

    // Step 2: 読めた token で接続を始める
    await this.startGateway({ token: token.value });
  }

  /**
   * Intents と保存した状態を揃えて GatewayClient を作り、最初の接続を予約する。
   * 1. 揃えられなければログに残し、次の cron で始め直す
   * 2. GatewayClient を作り、最初の接続を予約する
   */
  private async startGateway(args: { token: string }) {
    const prepared = await new PrepareGatewayUseCase({
      discord: new DiscordClient({ token: args.token }),
      gatewayStates: this.gatewayStates,
    }).execute();

    // Step 1: 揃えられなければログに残し、次の cron で始め直す
    if (prepared.isErr()) {
      console.error({ message: "Failed to prepare the gateway", error: prepared.error.toJSON() });
      return;
    }

    // Step 2: GatewayClient を作り、最初の接続を予約する
    const gateway = new GatewayClient({
      token: args.token,
      intents: prepared.value.intents,
      state: prepared.value.state,
    });
    this.gateway = gateway;
    await this.run({ gateway, outputs: gateway.start() });
  }

  /**
   * 期限の来たものを実行する。
   * 1. HELLO 待ちの期限なら、その socket を見限る
   * 2. 再接続の時刻なら socket を開く
   * 3. Heartbeat の時刻なら GatewayClient に渡す
   */
  private async runDue(args: { gateway: GatewayClient; now: number }) {
    const { gateway, now } = args;

    // Step 1: HELLO 待ちの期限なら、その socket を見限る
    if (this.helloDeadline !== null && this.helloDeadline.at <= now) {
      await this.abandon({ gateway, socket: this.helloDeadline.socket });
    }

    // Step 2: 再接続の時刻なら socket を開く
    if (this.reconnectTarget !== null && this.reconnectTarget.at <= now) {
      await this.open({ gateway, url: this.reconnectTarget.url });
    }

    // Step 3: Heartbeat の時刻なら GatewayClient に渡す
    if (this.heartbeatAt !== null && this.heartbeatAt <= now) {
      this.heartbeatAt = null;
      await this.run({ gateway, outputs: gateway.heartbeatDue() });
    }
  }

  /**
   * HELLO を期限までに受けなかった socket を手放して閉じ、閉じた socket として GatewayClient に渡す。
   * 1. その socket をもう手放していれば何もしない
   * 2. Session を残す code で閉じ、backoff の後に繋ぎ直させる
   */
  private async abandon(args: { gateway: GatewayClient; socket: WebSocket }) {
    this.helloDeadline = null;

    // Step 1: その socket をもう手放していれば何もしない
    if (this.socket !== args.socket) {
      return;
    }

    // Step 2: Session を残す code で閉じ、backoff の後に繋ぎ直させる
    console.warn({ message: "Gateway sent no HELLO in time" });
    this.disconnect(resumableCloseCode);
    await this.run({
      gateway: args.gateway,
      outputs: args.gateway.disconnected(abnormalCloseCode),
    });
  }

  /**
   * 予約した再接続を消して Gateway への socket を開き、開いたことを GatewayClient に渡す。
   * 1. 開けなければ、閉じた socket として GatewayClient に渡す
   * 2. 開けたら、この socket の frame と close を GatewayClient に渡すようにし、開いたことを渡す
   */
  private async open(args: { gateway: GatewayClient; url: string }) {
    const { gateway } = args;
    this.reconnectTarget = null;
    const opened = await this.sockets.open(args.url);

    // Step 1: 開けなければ、閉じた socket として GatewayClient に渡す
    if (opened.isErr()) {
      console.error({ message: "Failed to open the gateway socket", error: opened.error.toJSON() });
      await this.run({ gateway, outputs: gateway.disconnected(abnormalCloseCode) });
      return;
    }

    // Step 2: 開けたら、この socket の frame と close を GatewayClient に渡すようにし、開いたことを渡す
    this.adopt({ gateway, socket: opened.value });
    await this.run({ gateway, outputs: gateway.connected() });
  }

  /**
   * 開いた socket を今の socket にして HELLO を待ち始め、frame・close・error を GatewayClient に渡す。
   * 手放した socket の出来事は捨てる。
   */
  private adopt(args: { gateway: GatewayClient; socket: WebSocket }) {
    const { gateway, socket } = args;
    this.socket = socket;
    this.helloDeadline = { at: Date.now() + helloTimeout, socket };
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket || typeof event.data !== "string") {
        return;
      }
      this.lastReceivedAt = Date.now();
      void this.run({ gateway, outputs: gateway.received(event.data) });
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      console.warn({ message: "Gateway socket closed", code: event.code, reason: event.reason });
      void this.run({ gateway, outputs: gateway.disconnected(event.code) });
    });
    socket.addEventListener("error", () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      console.warn({ message: "Gateway socket failed" });
      void this.run({ gateway, outputs: gateway.disconnected(abnormalCloseCode) });
    });
  }

  /**
   * 入力の後の状態を保存し、出力を前の入力の出力の後ろに並べて実行する。dispatch の送信だけはこの列で
   * 待たない（execute の Step 3）。
   */
  private async run(args: { gateway: GatewayClient; outputs: GatewayOutput[] }) {
    // 受信の時刻は、出力が順番を待った分だけ遅れないよう、入力を受けた時点で取る。
    const receivedAt = Date.now();
    this.saveState(args.gateway);
    for (const output of args.outputs) {
      this.outputs = this.outputs
        .then(async () => this.execute({ output, receivedAt }))
        // 1 つの出力が失敗しても、続く出力は実行する。
        .catch((error: unknown) => {
          console.error({ message: "Failed to execute a gateway output", error: String(error) });
        });
    }
    return this.outputs;
  }

  /**
   * GatewayClient の永続状態を保存する。保存できなければログに残す。
   */
  private saveState(gateway: GatewayClient) {
    const saved = this.gatewayStates.save(gateway.state);

    if (saved.isErr()) {
      console.error({ message: "Failed to save the gateway state", error: saved.error.toJSON() });
    }
  }

  /**
   * GatewayClient の出力を 1 つ実行する。
   * 1. send: 今の socket に JSON で送る
   * 2. scheduleHeartbeat: heartbeat の期限を置き換え、alarm を掛け直す
   * 3. dispatch: READY か RESUMED なら接続済みにし、record を stream に送り始める。送信の完了は待たない
   * 4. disconnect: 今の socket を手放してから閉じる。その close は GatewayClient に渡さない
   * 5. reconnect: 再接続の期限を置き、alarm を掛け直す
   * 6. stop（残りの出力）: 期限をすべて捨てて止まる
   */
  private async execute(args: { output: GatewayOutput; receivedAt: number }) {
    const { output } = args;
    switch (output.type) {
      case "send": {
        // Step 1: send: 今の socket に JSON で送る
        return this.send(output.payload);
      }

      case "scheduleHeartbeat": {
        // Step 2: scheduleHeartbeat: heartbeat の期限を置き換え、alarm を掛け直す
        return this.scheduleHeartbeat(output.at);
      }

      case "dispatch": {
        // Step 3: dispatch: READY か RESUMED なら接続済みにし、record を stream に送り始める。送信の完了は
        // 待たない
        // 送信を出力の列で待つと、stream が詰まった間は heartbeat も再接続も止まり、Discord に切られる。
        void this.dispatch({ event: output.event, receivedAt: args.receivedAt });
        return undefined;
      }

      case "disconnect": {
        // Step 4: disconnect: 今の socket を手放してから閉じる。その close は GatewayClient に渡さない
        return this.disconnect(output.code);
      }

      case "reconnect": {
        // Step 5: reconnect: 再接続の期限を置き、alarm を掛け直す
        return this.scheduleReconnect(output);
      }

      default: {
        // Step 6: stop（残りの出力）: 期限をすべて捨てて止まる
        return this.stop(output.reason);
      }
    }
  }

  /**
   * 今の socket に payload を JSON で送る。
   * 1. socket が無ければ捨てる
   * 2. 送れなければログに残す
   * 3. IDENTIFY か RESUME なら、送ったことをログに残す
   */
  private send(payload: Extract<GatewayOutput, { type: "send" }>["payload"]) {
    // Step 1: socket が無ければ捨てる
    if (this.socket === null) {
      return;
    }

    // Step 2: 送れなければログに残す
    try {
      this.socket.send(JSON.stringify(payload));
    } catch (error) {
      console.error({
        message: "Failed to send a gateway payload",
        op: payload.op,
        error: String(error),
      });
      return;
    }

    // Step 3: IDENTIFY か RESUME なら、送ったことをログに残す
    // IDENTIFY は 1 日 1000 回までで、同じ application の別の bot と分け合う。READY の数では失敗した
    // IDENTIFY が数えられないので、送った回数をログから数える。token を含むので payload は出さない。
    if (payload.op === GatewayOpcodes.Identify || payload.op === GatewayOpcodes.Resume) {
      console.log({ message: `Gateway ${GatewayOpcodes[payload.op].toUpperCase()} sent` });
    }
  }

  /**
   * Dispatch を stream に送る。
   * 1. READY か RESUMED なら接続済みにする
   * 2. Record を送る。送れなければログに残すだけで、送り直さない
   */
  private async dispatch(args: {
    event: Extract<GatewayOutput, { type: "dispatch" }>["event"];
    receivedAt: number;
  }) {
    const { event } = args;

    // Step 1: READY か RESUMED なら接続済みにする
    if (
      event.type === GatewayDispatchEvents.Ready ||
      event.type === GatewayDispatchEvents.Resumed
    ) {
      this.phase = "connected";
      console.log({ message: "Gateway connected", type: event.type, sequence: event.sequence });
    }

    // Step 2: Record を送る。送れなければログに残すだけで、送り直さない
    const sent = await this.events.send(args);

    if (sent.isErr()) {
      console.error({
        message: "Failed to record a dispatch",
        type: event.type,
        sequence: event.sequence,
        error: sent.error.toJSON(),
      });
    }
  }

  /**
   * 今の socket を手放してから閉じる。閉じられなくても、もう使わないので捨てる。
   */
  private disconnect(code: number) {
    const { socket } = this;
    this.socket = null;
    this.heartbeatAt = null;
    try {
      socket?.close(code);
    } catch (error) {
      console.warn({ message: "Failed to close the gateway socket", code, error: String(error) });
    }
  }

  /**
   * Heartbeat の期限を置き換え、alarm を掛け直す。heartbeat が予約されたのは HELLO を受けたからなので、
   * HELLO 待ちの期限も捨てる。
   */
  private async scheduleHeartbeat(at: number) {
    this.helloDeadline = null;
    this.heartbeatAt = at;
    await this.scheduleAlarm();
  }

  /**
   * 再接続の期限を置き、alarm を掛け直す。
   */
  private async scheduleReconnect(output: Extract<GatewayOutput, { type: "reconnect" }>) {
    this.phase = "connecting";
    this.reconnectTarget = { at: output.at, url: output.url };
    console.log({ message: "Gateway reconnect scheduled", at: output.at, resume: output.resume });
    await this.scheduleAlarm();
  }

  /**
   * 期限をすべて捨てて止まる。
   */
  private async stop(reason: string) {
    this.phase = "stopped";
    this.helloDeadline = null;
    this.heartbeatAt = null;
    this.reconnectTarget = null;
    console.error({ message: "Gateway stopped", reason });
    await this.scheduleAlarm();
  }

  /**
   * HELLO 待ち・再接続・heartbeat のうち最も早い期限に alarm を掛ける。期限が無ければ alarm を消す。
   */
  private async scheduleAlarm() {
    // 1 つの DO は 1 つの alarm しか持てないので、期限を最も早いものにまとめる。
    const deadlines = [this.helloDeadline?.at, this.reconnectTarget?.at, this.heartbeatAt].filter(
      (at) => at !== null && at !== undefined,
    );

    if (deadlines.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.min(...deadlines));
  }
}
