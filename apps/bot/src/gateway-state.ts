import type { GatewayState, StatusReport } from "@migiwa/gateway";

const GATEWAY_KEY = "gateway",
  DAY_MS = 86_400_000,
  // Only the GUILD_CREATE burst right after READY describes users who left while the bot was
  // Away; a later GUILD_CREATE (a new guild, an outage ending) must use its own receive time.
  SNAPSHOT_WINDOW_MS = 300_000;

export { GATEWAY_KEY };

// Everything the gateway client must survive a restart with (spec §5.1). Lives in ctx.storage.kv,
// Never in SQL, so the MCP query tool cannot reach the session id.
export interface GatewayStore {
  session_id: string | null;
  seq: number | null;
  resume_gateway_url: string | null;
  status: GatewayState;
  status_reason: string | null;
  status_since: number;
  backoff_until: number | null;
  backoff_attempt: number;
  identify_remaining: number | null;
  identify_reset_at: number | null;
  last_ack_at: number | null;
  last_heartbeat_at: number | null;
  last_event_at: number | null;
  disconnected_at: number | null;
  bot_user_id: string | null;
  // Timestamps of connect attempts, pruned to the last 24 hours (status().reconnects_24h).
  reconnects: number[];
}

export function initialGatewayStore(now: number): GatewayStore {
  return {
    session_id: null,
    seq: null,
    resume_gateway_url: null,
    status: "stopped",
    status_reason: null,
    status_since: now,
    backoff_until: null,
    backoff_attempt: 0,
    identify_remaining: null,
    identify_reset_at: null,
    last_ack_at: null,
    last_heartbeat_at: null,
    last_event_at: null,
    disconnected_at: null,
    bot_user_id: null,
    reconnects: [],
  };
}

// Spread merge, not `?? initialGatewayStore(now)`: a field added to GatewayStore after an
// Object was already stored must still get its default, not `undefined`.
export function readGateway(kv: SyncKvStorage, now: number): GatewayStore {
  return { ...initialGatewayStore(now), ...kv.get<Partial<GatewayStore>>(GATEWAY_KEY) };
}

export function writeGateway(kv: SyncKvStorage, store: GatewayStore): void {
  kv.put(GATEWAY_KEY, store);
}

// `disconnected_at` is what GUILD_CREATE reconciliation uses as ended_at for users that went away
// While the bot was down (spec §6.3), so it is stamped exactly when "connected" ends.
export function withStatus(
  store: GatewayStore,
  status: GatewayState,
  reason: string | null,
  now: number,
): GatewayStore {
  if (store.status === status && store.status_reason === reason) {
    return store;
  }
  const lostConnection = store.status === "connected" && status !== "connected";
  return {
    ...store,
    status,
    status_reason: reason,
    status_since: now,
    disconnected_at: lostConnection ? now : store.disconnected_at,
  };
}

// After close codes that forbid RESUME (spec §5.7).
export function clearSession(store: GatewayStore): GatewayStore {
  return { ...store, session_id: null, seq: null, resume_gateway_url: null };
}

export function recordReconnect(store: GatewayStore, now: number): GatewayStore {
  const recent = store.reconnects.filter((at) => at > now - DAY_MS);
  return { ...store, reconnects: [...recent, now] };
}

// GUILD_CREATE reconciliation (spec §6.3) wants the moment the bot lost its socket, but only
// While that loss is still what explains the snapshot: past SNAPSHOT_WINDOW_MS, a fresh
// GUILD_CREATE describes a new guild or a recovery long after the fact, not the outage itself,
// So it must fall back to the dispatch's own received_at instead (ingestDispatch's job).
export function snapshotDisconnectedAt(store: GatewayStore, now: number): number | null {
  if (store.disconnected_at === null) {
    return null;
  }
  return now - store.status_since < SNAPSHOT_WINDOW_MS ? store.disconnected_at : null;
}

export function toStatusReport(store: GatewayStore, guildCount: number, now: number): StatusReport {
  return {
    state: store.status,
    since: store.status_since,
    reason: store.status_reason,
    last_event_at: store.last_event_at,
    seq: store.seq,
    guild_count: guildCount,
    reconnects_24h: store.reconnects.filter((at) => at > now - DAY_MS).length,
    identify_remaining: store.identify_remaining,
  };
}
