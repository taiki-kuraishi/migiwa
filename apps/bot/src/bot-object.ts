import type { DatabaseClient } from "@migiwa/db";
import type {
  HeartbeatState,
  QueryResult,
  StatusReport,
  TableInfo,
  ValidatedDispatch,
} from "@migiwa/gateway";
import type { GatewayDispatchPayload, GatewayReceivePayload } from "discord-api-types/v10";

import { createDatabaseClient, ensureReadOnly, guilds } from "@migiwa/db";
import migrations from "@migiwa/db/migrations";
import {
  backoffDelayMs,
  decideOnClose,
  FATAL_RETRY_MS,
  gatewayHttpUrl,
  GatewayOpcodes,
  heartbeatOnAck,
  heartbeatOnHello,
  heartbeatOnSend,
  heartbeatPayload,
  IDENTIFY_RESERVE,
  identifyPayload,
  invalidSessionDelayMs,
  isHealthy,
  isHeartbeatDue,
  isZombie,
  parseGatewayMessage,
  RECONNECT_CLOSE_CODE,
  resumePayload,
  validateDispatch,
  validateHello,
} from "@migiwa/gateway";
import { Result } from "better-result";
import { DurableObject } from "cloudflare:workers";
import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";

import type { ConnectError } from "./gateway-errors";
import type { GatewayStore } from "./gateway-state";
import type { GuildFilter } from "./ingest/dispatch";

import { fetchGatewayBot, openGatewaySocket } from "./discord-rest";
import { IdentifyBudgetExhausted, ShardingRequired } from "./gateway-errors";
import {
  clearSession,
  readGateway,
  recordReconnect,
  snapshotDisconnectedAt,
  toStatusReport,
  withStatus,
  writeGateway,
} from "./gateway-state";
import { guildFilter, ingestDispatch } from "./ingest/dispatch";
import { describeError, log } from "./log";
import { readOnlyExec } from "./read-only-exec";

// A connect() that has not produced a HELLO within this window is treated as stuck.
const CONNECT_GRACE_MS = 60_000,
  // When alarm() itself throws, try again this much later so the chain never ends silently.
  FALLBACK_ALARM_MS = 30_000;

export class BotObject extends DurableObject {
  public readonly db: DatabaseClient;

  // In-memory only: an outbound socket never survives a restart, so neither does its
  // Heartbeat bookkeeping. Everything that must survive is in gateway-state.ts.
  private socket: WebSocket | null = null;
  private heartbeat: HeartbeatState | null = null;
  private connecting: Promise<void> | null = null;
  private readonly allowGuild: GuildFilter;
  // Ingest outcomes since the last heartbeat, flushed as one log line (spec §9).
  private readonly counters = new Map<string, number>();

  public constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.db = createDatabaseClient(ctx.storage);
    // Wrangler.jsonc's declared default types this non-optional, but a deploy missing the var
    // (Spec §8) must not take the object down; guildFilter() defaults a missing value itself.
    this.allowGuild = guildFilter(env.DISCORD_GUILD_IDS);
    // Every RPC may assume the schema exists: blockConcurrencyWhile holds every other call on
    // This object until the callback settles. Drizzle's journal makes re-running it on each
    // Restart a no-op.
    void ctx.blockConcurrencyWhile(async () => migrate(this.db, migrations));
  }

  public async status(): Promise<StatusReport> {
    const now = Date.now();
    return toStatusReport(readGateway(this.ctx.storage.kv, now), this.guildCount(), now);
  }

  // Called by the cron every minute (spec §5.2). Not named `connect`: that collides with
  // Fetcher.connect on the stub.
  public async ensureConnected(): Promise<StatusReport> {
    const now = Date.now(),
      store = readGateway(this.ctx.storage.kv, now),
      waiting = store.backoff_until !== null && store.backoff_until > now,
      open = this.socket?.readyState === WebSocket.READY_STATE_OPEN,
      healthy = open && this.heartbeat !== null && isHealthy(this.heartbeat, now),
      settling =
        this.connecting !== null ||
        (open && this.heartbeat === null && now - store.status_since < CONNECT_GRACE_MS);
    if (!waiting && !healthy && !settling) {
      await this.beginConnect();
    }
    return this.status();
  }

  // Feeds the MCP tool description (spec §7.2): user tables only, without SQLite's own tables,
  // Drizzle's journal and workerd's `_cf_*` internals.
  public async schema(): Promise<TableInfo[]> {
    // Exec()'s generic requires an index signature, which the shared TableInfo interface does
    // Not declare; the intersection satisfies it without loosening the public type.
    return this.ctx.storage.sql
      .exec<TableInfo & Record<string, SqlStorageValue>>(
        String.raw`SELECT name, sql FROM sqlite_master WHERE type = 'table'
          AND name NOT LIKE 'sqlite\_%' ESCAPE '\'
          AND name NOT LIKE '\_\_%' ESCAPE '\'
          AND name NOT LIKE '\_cf\_%' ESCAPE '\' ORDER BY name`,
      )
      .toArray();
  }

  // Read-only SQL for the MCP tool (spec §7.3). Raw exec on purpose: the SQL is the user's,
  // So Drizzle's query builder has nothing to add here.
  public async query(sql: string): Promise<QueryResult> {
    // RPC boundary (spec D12): a Result cannot cross structured clone, so Err becomes a throw
    // And the MCP tool turns it into an isError response. Two layers (spec §7.3): the text
    // Guard in @migiwa/db, then readOnlyExec(), which rolls back anything that still wrote.
    const statement = ensureReadOnly(sql);
    if (statement.isErr()) {
      throw new Error(statement.error.message);
    }
    return readOnlyExec(this.ctx.storage, statement.value);
  }

  // Heartbeats and the reconnect timer share this one alarm (spec §5.5). Alarms, unlike
  // Timers, keep the object alive, which is what makes the socket outlive the 70 s idle rule.
  public override async alarm(): Promise<void> {
    try {
      const now = Date.now(),
        // Read before maybeSendHeartbeat(), which may write last_heartbeat_at: safe only
        // Because `store` below is read for backoff_until, a field that write never touches.
        store = readGateway(this.ctx.storage.kv, now),
        open = this.socket?.readyState === WebSocket.READY_STATE_OPEN;
      this.maybeSendHeartbeat(now);
      // The `connecting`/`open` guards are belt-and-braces alongside doConnect() clearing
      // `backoff_until` when a connect attempt starts (see there): even a `store` read before
      // That write lands must not restart a connect that is already running or already holds
      // An open socket.
      if (
        store.backoff_until !== null &&
        store.backoff_until <= now &&
        this.connecting === null &&
        !open
      ) {
        await this.beginConnect();
      }
      this.scheduleAlarm(Date.now());
    } catch (error) {
      log("alarm_error", { message: describeError(error) });
      await this.ctx.storage.setAlarm(Date.now() + FALLBACK_ALARM_MS);
    }
  }

  // Split out of alarm() to stay under the statement-count limit. A zombie gets a non-1000
  // Close instead of a heartbeat: Discord wants the reconnect, not another heartbeat it will
  // Also fail to ack.
  private maybeSendHeartbeat(now: number): void {
    if (this.socket === null || this.heartbeat === null || !isHeartbeatDue(this.heartbeat, now)) {
      return;
    }
    if (isZombie(this.heartbeat, now)) {
      log("zombie");
      this.socket.close(RECONNECT_CLOSE_CODE, "heartbeat ack missing");
      return;
    }
    this.sendHeartbeat(now);
  }

  // Serialises overlapping callers (a cron tick racing the alarm) onto one attempt. Not named
  // `connect`: DurableObject declares an optional `connect(socket: Socket)` lifecycle hook for
  // Inbound TCP connections, and a subclass member cannot narrow that public, differently-typed
  // Member to a private method of a different signature.
  private async beginConnect(): Promise<void> {
    this.connecting ??= this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  // The only async path in the object (spec §5.3). One Result.gen railway: every way it can
  // Fail is a TaggedError from gateway-errors.ts and onConnectError() matches them all.
  private async doConnect(): Promise<void> {
    const { kv } = this.ctx.storage,
      now = Date.now(),
      // Read before dropSocket(): safe only because dropSocket() never writes here itself — it
      // Nulls this.socket first, so onClose()'s identity guard on the old socket's close event
      // Bails out before it can call scheduleReconnect().
      current = recordReconnect(readGateway(kv, now), now),
      resuming = current.session_id !== null && current.resume_gateway_url !== null;
    this.dropSocket();
    // Clear the stale deadline so scheduleAlarm() cannot pick it as the earliest wake-up and fire
    // An alarm that tears this handshake down before HELLO arrives (`backoff_attempt` survives so
    // The next real failure keeps counting up). Between now and HELLO the alarm may have no
    // Deadline to schedule at all; ensureConnected()'s CONNECT_GRACE_MS window, not the alarm, is
    // What notices a connect() stuck that long.
    writeGateway(kv, {
      ...withStatus(current, resuming ? "resuming" : "connecting", null, now),
      backoff_until: null,
    });
    // RESUME is the normal path (spec §4): the process dies several times a day, the session
    // Does not. Discord replays every dispatch after `seq`, which the ingest transaction wrote.
    if (resuming && current.resume_gateway_url !== null) {
      const resumed = await openGatewaySocket(gatewayHttpUrl(current.resume_gateway_url));
      resumed.match({
        ok: (socket) => this.adoptSocket(socket),
        err: (error) => this.onConnectError(error),
      });
      return;
    }
    await this.attemptConnect(kv, this.env.DISCORD_BOT_TOKEN);
  }

  // Split out of doConnect() to keep its own const group away from the dropSocket()/writeGateway()
  // Side effects above, which must run first (spec §5.3).
  private async attemptConnect(kv: SyncKvStorage, token: string): Promise<void> {
    const attempt = await Result.gen(async function* () {
      const info = yield* Result.await(fetchGatewayBot(token)),
        limit = info.session_start_limit,
        then = Date.now();
      writeGateway(kv, {
        ...readGateway(kv, then),
        identify_remaining: limit.remaining,
        identify_reset_at: then + limit.reset_after,
      });
      if (info.shards > 1) {
        return Result.err(
          new ShardingRequired({
            shards: info.shards,
            message: `Discord wants ${info.shards} shards; v1 runs exactly one`,
          }),
        );
      }
      if (limit.remaining >= IDENTIFY_RESERVE) {
        const socket = yield* Result.await(openGatewaySocket(gatewayHttpUrl(info.url)));
        return Result.ok(socket);
      }
      return Result.err(
        new IdentifyBudgetExhausted({
          remaining: limit.remaining,
          reset_after: limit.reset_after,
          message: `only ${limit.remaining} IDENTIFYs left today; keeping ${IDENTIFY_RESERVE} in reserve`,
        }),
      );
    });
    attempt.match({
      ok: (socket) => this.adoptSocket(socket),
      err: (error) => this.onConnectError(error),
    });
  }

  // Listeners are attached here rather than in discord-rest.ts because they need `this`.
  private adoptSocket(socket: WebSocket): void {
    this.socket = socket;
    this.heartbeat = null;
    socket.addEventListener("message", (event) => this.onMessage(event.data));
    socket.addEventListener("close", (event) => this.onClose(socket, event.code, event.reason));
    socket.addEventListener("error", () => this.onClose(socket, undefined, "socket_error"));
    log("socket_open");
  }

  // Spec §5.3 step 4 and §5.7: which failure means fatal (a human must act), wait (Discord
  // Said when) or backoff. Exhaustive over ConnectError by construction.
  private onConnectError(error: ConnectError): void {
    const now = Date.now(),
      { kv } = this.ctx.storage;
    error.match({
      GatewayBotFailed: (failure) => {
        if (failure.status === 401) {
          this.fail(readGateway(kv, now), "authentication_failed", now);
        } else {
          this.scheduleReconnect(failure.message);
        }
      },
      ShardingRequired: () => this.fail(readGateway(kv, now), "sharding_required", now),
      IdentifyBudgetExhausted: (budget) => {
        const waiting = { ...readGateway(kv, now), backoff_until: now + budget.reset_after };
        writeGateway(kv, withStatus(waiting, "backoff", "identify_budget", now));
        log("identify_budget", { remaining: budget.remaining, reset_after: budget.reset_after });
        this.scheduleAlarm(now);
      },
      UpgradeFailed: (upgrade) => this.scheduleReconnect(upgrade.message),
    });
  }

  // Synchronous on purpose (spec §5.4): the event loop then delivers frames in order and no
  // Promise chain or re-entrancy guard is needed. Nothing here closes the socket on an
  // Application error; it is logged and the next frame is processed.
  private onMessage(data: string | ArrayBuffer): void {
    try {
      const parsed = parseGatewayMessage(data);
      if (parsed.isErr()) {
        this.count(`frame:${parsed.error.reason}`);
        return;
      }
      this.handleFrame(parsed.value, Date.now());
    } catch (error) {
      log("message_error", { message: describeError(error) });
      this.count("frame:error");
    }
  }

  // Split out of onMessage() to keep its own const group from needing `message` narrowed before
  // The parsed.isErr() check above returns. An if/else-if chain over the six opcodes, not a
  // Switch: unicorn/switch-case-braces counts each braced case block's statements against the
  // Limit on its own, which this chain sidesteps while still fitting the limit as one method.
  private handleFrame(message: GatewayReceivePayload, now: number): void {
    if (message.op === GatewayOpcodes.Hello) {
      validateHello(message.d).match({
        ok: (hello) => this.onHello(hello.heartbeat_interval, now),
        err: (error) => this.count(`hello:${error.path}`),
      });
    } else if (message.op === GatewayOpcodes.Heartbeat) {
      this.sendHeartbeat(now);
    } else if (message.op === GatewayOpcodes.HeartbeatAck) {
      this.onHeartbeatAck(now);
    } else if (message.op === GatewayOpcodes.Dispatch) {
      this.handleDispatch(message, now);
    } else if (message.op === GatewayOpcodes.Reconnect) {
      this.reconnectNow("reconnect_requested");
    } else if (message.op === GatewayOpcodes.InvalidSession) {
      // `d` is trusted only as far as it being `true` (spec §5.4 does not validate op 9's `d`);
      // Anything else Discord might one day send here must not be read as resumable.
      // oxlint-disable-next-line typescript/no-unnecessary-boolean-literal-compare -- `boolean` is discord-api-types' claim, not a runtime guarantee.
      this.onInvalidSession(message.d === true, now);
    }
  }

  // The seq still advances even when `d` is rejected: Discord counts the frame delivered.
  private handleDispatch(message: GatewayDispatchPayload, now: number): void {
    const dispatch = validateDispatch(message);
    this.onDispatch(message.s, dispatch.isOk() ? dispatch.value : null, now);
    if (dispatch.isErr()) {
      this.count(`${dispatch.error.event}:dropped:${dispatch.error.path}`);
    }
  }

  private onHello(intervalMs: number, now: number): void {
    const { socket } = this,
      { kv } = this.ctx.storage,
      store = readGateway(kv, now);
    if (socket === null) {
      return;
    }
    this.heartbeat = heartbeatOnHello(intervalMs, now);
    if (store.session_id !== null) {
      socket.send(resumePayload(this.env.DISCORD_BOT_TOKEN, store.session_id, store.seq ?? 0));
      log("resume", { seq: store.seq });
    } else {
      this.sendIdentify(socket, kv, store);
    }
    this.scheduleAlarm(now);
  }

  // Split out of onHello() to stay under the statement-count limit.
  private sendIdentify(socket: WebSocket, kv: SyncKvStorage, store: GatewayStore): void {
    socket.send(identifyPayload(this.env.DISCORD_BOT_TOKEN));
    const remaining = store.identify_remaining === null ? null : store.identify_remaining - 1;
    writeGateway(kv, { ...store, identify_remaining: remaining });
    log("identify", { identify_remaining: remaining });
  }

  private onHeartbeatAck(now: number): void {
    if (this.heartbeat === null) {
      return;
    }
    this.heartbeat = heartbeatOnAck(this.heartbeat, now);
    const { kv } = this.ctx.storage;
    writeGateway(kv, { ...readGateway(kv, now), last_ack_at: now });
  }

  // One transaction per dispatch: seq, the raw event and the session ops commit together, so
  // A RESUME after a crash replays exactly the events that were not applied (spec §6.4).
  // `dispatch` is null when validateDispatch() rejected `d`.
  private onDispatch(seq: number, dispatch: ValidatedDispatch | null, now: number): void {
    const { kv } = this.ctx.storage;
    this.ctx.storage.transactionSync(() => {
      let store: GatewayStore = { ...readGateway(kv, now), seq, last_event_at: now };
      if (dispatch?.t === "READY") {
        store = withStatus(
          {
            ...store,
            session_id: dispatch.d.session_id,
            resume_gateway_url: dispatch.d.resume_gateway_url,
            bot_user_id: dispatch.d.user.id,
            backoff_attempt: 0,
            backoff_until: null,
          },
          "connected",
          null,
          now,
        );
        log("ready", { guilds: dispatch.d.guilds.length });
      } else if (dispatch?.t === "RESUMED") {
        store = withStatus(
          { ...store, backoff_attempt: 0, backoff_until: null },
          "connected",
          null,
          now,
        );
        log("resumed", { seq });
      }
      if (dispatch !== null) {
        // `store` carries this dispatch's already-updated disconnected_at/status_since
        // (READY/RESUMED above may have just changed them), which is what the snapshot window reads.
        const awaySince = snapshotDisconnectedAt(store, now),
          outcome = ingestDispatch(this.db, dispatch, now, awaySince, this.allowGuild),
          label = dispatch.t === "OTHER" ? dispatch.name : dispatch.t,
          gateway = dispatch.t === "READY" || dispatch.t === "RESUMED";
        this.count(`${label}:${gateway ? "gateway" : outcome}`);
      }
      writeGateway(kv, store);
    });
  }

  private sendHeartbeat(now: number): void {
    this.flushCounters();
    if (this.socket === null || this.heartbeat === null) {
      return;
    }
    const { kv } = this.ctx.storage,
      store = readGateway(kv, now);
    this.socket.send(heartbeatPayload(store.seq));
    this.heartbeat = heartbeatOnSend(this.heartbeat, now);
    writeGateway(kv, { ...store, last_heartbeat_at: now });
  }

  private count(key: string): void {
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  private flushCounters(): void {
    if (this.counters.size === 0) {
      return;
    }
    log("ingest", Object.fromEntries(this.counters));
    this.counters.clear();
  }

  private onClose(socket: WebSocket, code: number | undefined, reason: string): void {
    // A socket we already replaced through dropSocket(): nothing to do.
    if (socket !== this.socket) {
      return;
    }
    this.socket = null;
    this.heartbeat = null;
    log("socket_closed", { code, reason });
    this.applyCloseDecision(code, reason);
  }

  // Split out of onClose() to stay under the statement-count limit. Spec §5.7: a fatal code
  // Needs a human, an IDENTIFY code forbids RESUME and waits Discord's 1-5 s before the next
  // IDENTIFY (same as onInvalidSession(false, …) below), everything else resumes with the usual
  // Exponential backoff. reconnectNow() (op 7) and onInvalidSession() (op 9) cover the other two
  // Ways a session ends.
  private applyCloseDecision(code: number | undefined, reason: string): void {
    const now = Date.now(),
      { kv } = this.ctx.storage,
      decision = decideOnClose(code),
      closeReason = reason === "" ? `close_${code ?? "unknown"}` : reason;
    if (decision.kind === "fatal") {
      this.fail(readGateway(kv, now), decision.reason, now);
      return;
    }
    if (decision.kind === "identify") {
      this.invalidSessionBackoff(clearSession(readGateway(kv, now)), closeReason, now);
      return;
    }
    this.scheduleReconnect(closeReason);
  }

  // Closing with 1000/1001 tells Discord the client is done, so it discards the session; the
  // RESUME that follows then fails with op 9 (`d: false`) (spec §5.5) — every close meant to
  // Precede a RESUME must use RECONNECT_CLOSE_CODE instead. The mock Discord only models that one
  // 1000/1001 rule; every other close-code rule it accepts regardless is listed as a shortcut in
  // Its header (mock-discord/worker.js). "op 7 Reconnect closes the socket and resumes at once" in
  // Reconnect.spec.ts regression-tests this close code choice against the rule the mock does model.
  private dropSocket(): void {
    const { socket } = this;
    this.socket = null;
    this.heartbeat = null;
    if (socket === null) {
      return;
    }
    try {
      socket.close(RECONNECT_CLOSE_CODE, "replaced");
    } catch {
      // Already closed by the other side.
    }
  }

  // Op 7: Discord wants us to reconnect now; no backoff, RESUME on the new socket.
  // Unlike alarm()'s awaited call to beginConnect(), this one is fire-and-forget from a
  // Synchronous message handler, so a rejection (doConnect() throwing) needs its own catch or it
  // Surfaces nowhere.
  private reconnectNow(reason: string): void {
    log("reconnect", { reason });
    this.dropSocket();
    void this.beginConnect().catch((error: unknown) =>
      log("connect_error", { message: describeError(error) }),
    );
  }

  // Op 9: wait 1-5 s (Discord's rule), then RESUME if `d` is true, else IDENTIFY afresh.
  private onInvalidSession(resumable: boolean, now: number): void {
    this.dropSocket();
    const { kv } = this.ctx.storage,
      store = resumable ? readGateway(kv, now) : clearSession(readGateway(kv, now)),
      reason = resumable ? "invalid_session_resumable" : "invalid_session";
    this.invalidSessionBackoff(store, reason, now);
  }

  // Shared by onInvalidSession(false, …) and applyCloseDecision()'s identify branch (spec §5.7's
  // 4003/4007/4009 row): discard-or-keep the session is the caller's job (via `store`), waiting
  // Discord's 1-5 s before the alarm's next connect() is not.
  private invalidSessionBackoff(store: GatewayStore, reason: string, now: number): void {
    const delay = invalidSessionDelayMs(),
      waiting = { ...store, backoff_until: now + delay };
    writeGateway(this.ctx.storage.kv, withStatus(waiting, "backoff", reason, now));
    // `delay_ms` feeds Task 15's "time not connected" estimate the same way scheduleReconnect()'s
    // Own "backoff" log does.
    log("invalid_session", { delay_ms: delay, reason });
    this.scheduleAlarm(now);
  }

  // Exponential backoff (spec §5.7); the alarm calls connect() when it elapses.
  private scheduleReconnect(reason: string): void {
    const now = Date.now(),
      { kv } = this.ctx.storage,
      store = readGateway(kv, now),
      delay = backoffDelayMs(store.backoff_attempt),
      next = {
        ...store,
        backoff_attempt: store.backoff_attempt + 1,
        backoff_until: now + delay,
      };
    writeGateway(kv, withStatus(next, "backoff", reason, now));
    log("backoff", { attempt: next.backoff_attempt, delay_ms: delay, reason });
    this.scheduleAlarm(now);
  }

  // A close code only a human can fix: try again in an hour to protect the IDENTIFY budget.
  private fail(store: GatewayStore, reason: string, now: number): void {
    const failed = { ...store, backoff_until: now + FATAL_RETRY_MS };
    writeGateway(this.ctx.storage.kv, withStatus(failed, "fatal", reason, now));
    log("fatal", { reason });
    this.scheduleAlarm(now);
  }

  // One alarm for every deadline: the earliest of the next heartbeat and the reconnect.
  // Number.isFinite(), not `typeof at === "number"`, keeps a NaN nextDueAt (typia already
  // Validates heartbeat_interval, but defense in depth) out of setAlarm(), which throws on it.
  private scheduleAlarm(now: number): void {
    const store = readGateway(this.ctx.storage.kv, now),
      deadlines = [this.heartbeat?.nextDueAt, store.backoff_until].filter((at): at is number =>
        Number.isFinite(at),
      );
    if (deadlines.length === 0) {
      return;
    }
    void this.ctx.storage.setAlarm(Math.floor(Math.min(...deadlines)));
  }

  private guildCount(): number {
    return (
      this.db.select({ n: count() }).from(guilds).where(eq(guilds.available, true)).get()?.n ?? 0
    );
  }
}
