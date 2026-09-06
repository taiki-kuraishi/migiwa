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
  FATAL_RETRY_MS,
  gatewayHttpUrl,
  GatewayOpcodes,
  heartbeatOnAck,
  heartbeatOnHello,
  heartbeatOnSend,
  heartbeatPayload,
  IDENTIFY_RESERVE,
  identifyPayload,
  isHealthy,
  isHeartbeatDue,
  isZombie,
  parseGatewayMessage,
  RECONNECT_CLOSE_CODE,
  validateDispatch,
  validateHello,
} from "@migiwa/gateway";
import { Result } from "better-result";
import { DurableObject } from "cloudflare:workers";
import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";

import type { ConnectError } from "./gateway-errors";
import type { GatewayStore } from "./gateway-state";

import { fetchGatewayBot, openGatewaySocket } from "./discord-rest";
import { IdentifyBudgetExhausted, ShardingRequired } from "./gateway-errors";
import {
  readGateway,
  recordReconnect,
  toStatusReport,
  withStatus,
  writeGateway,
} from "./gateway-state";
import { log } from "./log";
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

  public constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.db = createDatabaseClient(ctx.storage);
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
        store = readGateway(this.ctx.storage.kv, now);
      this.maybeSendHeartbeat(now);
      if (store.backoff_until !== null && store.backoff_until <= now) {
        await this.beginConnect();
      }
      this.scheduleAlarm(Date.now());
    } catch (error) {
      log("alarm_error", { message: error instanceof Error ? error.message : String(error) });
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
      store = readGateway(kv, now),
      reconnected = withStatus(recordReconnect(store, now), "connecting", null, now);
    this.dropSocket();
    writeGateway(kv, reconnected);
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
        log("frame_dropped", { reason: parsed.error.reason });
        return;
      }
      this.handleFrame(parsed.value, Date.now());
    } catch (error) {
      log("message_error", { message: error instanceof Error ? error.message : String(error) });
    }
  }

  // Split out of onMessage() to keep its own const group from needing `message` narrowed before
  // The parsed.isErr() check above returns, and to stay under the statement-count limit.
  private handleFrame(message: GatewayReceivePayload, now: number): void {
    switch (message.op) {
      case GatewayOpcodes.Hello: {
        validateHello(message.d).match({
          ok: (hello) => this.onHello(hello.heartbeat_interval, now),
          err: (error) => log("frame_dropped", { reason: `hello:${error.path}` }),
        });
        break;
      }
      case GatewayOpcodes.Heartbeat: {
        this.sendHeartbeat(now);
        break;
      }
      case GatewayOpcodes.HeartbeatAck: {
        this.onHeartbeatAck(now);
        break;
      }
      case GatewayOpcodes.Dispatch: {
        this.handleDispatch(message, now);
        break;
      }
      default: {
        break;
      }
    }
  }

  // The seq still advances even when `d` is rejected: Discord counts the frame delivered.
  private handleDispatch(message: GatewayDispatchPayload, now: number): void {
    const dispatch = validateDispatch(message);
    this.onDispatch(message.s, dispatch.isOk() ? dispatch.value : null, now);
    if (dispatch.isErr()) {
      log("frame_dropped", { reason: `${dispatch.error.event}:${dispatch.error.path}` });
    }
  }

  private onHello(intervalMs: number, now: number): void {
    if (this.socket === null) {
      return;
    }
    this.heartbeat = heartbeatOnHello(intervalMs, now);
    const { kv } = this.ctx.storage,
      store = readGateway(kv, now),
      remaining = store.identify_remaining === null ? null : store.identify_remaining - 1;
    this.socket.send(identifyPayload(this.env.DISCORD_BOT_TOKEN));
    writeGateway(kv, { ...store, identify_remaining: remaining });
    log("identify", { identify_remaining: remaining });
    this.scheduleAlarm(now);
  }

  private onHeartbeatAck(now: number): void {
    if (this.heartbeat === null) {
      return;
    }
    this.heartbeat = heartbeatOnAck(this.heartbeat, now);
    const { kv } = this.ctx.storage;
    writeGateway(kv, { ...readGateway(kv, now), last_ack_at: now });
  }

  // Every dispatch advances seq inside one transaction (spec §6.4); it stays limited to gateway
  // KV state until a later task starts writing sessionizer rows into this same transaction
  // (wave 12 in the plan). `dispatch` is null when validateDispatch() rejected `d`.
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
      }
      writeGateway(kv, store);
    });
  }

  private sendHeartbeat(now: number): void {
    if (this.socket === null || this.heartbeat === null) {
      return;
    }
    const { kv } = this.ctx.storage,
      store = readGateway(kv, now);
    this.socket.send(heartbeatPayload(store.seq));
    this.heartbeat = heartbeatOnSend(this.heartbeat, now);
    writeGateway(kv, { ...store, last_heartbeat_at: now });
  }

  private onClose(socket: WebSocket, code: number | undefined, reason: string): void {
    // A socket we already replaced through dropSocket(): nothing to do.
    if (socket !== this.socket) {
      return;
    }
    this.socket = null;
    this.heartbeat = null;
    log("socket_closed", { code, reason });
    this.scheduleReconnect(reason === "" ? `close_${code ?? "unknown"}` : reason);
  }

  // Closing with 1000/1001 tells Discord the client is done, so it discards the session; the
  // RESUME that follows then fails with op 9 (`d: false`) (spec §5.5) — every close meant to
  // Precede a RESUME must use RECONNECT_CLOSE_CODE instead. Today doConnect() is the only
  // Caller; a later task adds reconnectNow() (the op 7 Reconnect path, expected to be the most
  // Frequent reconnect during the 24-hour soak) and onInvalidSession() as further callers, and
  // Each of those must route through here too — which is exactly what makes a wrong close code
  // Here so easy to trip over. This wave's mock Discord accepts a RESUME regardless of the
  // Close code that preceded it, so a regression here has no test in this suite; only the
  // 24-hour soak would catch it.
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
  //
  // This filter must use `Number.isFinite(at)`, not `typeof at === "number"`.
  // `HELLO.d.heartbeat_interval` sits outside the envelope guard (which checks only the
  // Envelope's `op`/`s`/`t`, never `d`), so a missing field there can leave
  // `heartbeatOnHello()`'s `nextDueAt` as `NaN`. `typeof NaN === "number"` is `true`, so a
  // `typeof` check would let NaN through into `ctx.storage.setAlarm()`, which throws on it.
  // That throw is swallowed by `onMessage()`'s try/catch, so the failure is silent: no alarm
  // Is scheduled again and the object sits idle until the next cron tick notices.
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
