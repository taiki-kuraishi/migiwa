export type GatewayState =
  | "stopped"
  | "connecting"
  | "connected"
  | "resuming"
  | "backoff"
  | "fatal";

// What BotObject.status() returns and what remote-mcp's /health serves (spec §5.8, §7.4).
export interface StatusReport {
  state: GatewayState;
  since: number;
  reason: string | null;
  last_event_at: number | null;
  seq: number | null;
  guild_count: number;
  reconnects_24h: number;
  identify_remaining: number | null;
}

// What BotObject.query() returns (spec §7.3).
export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rows_read: number;
  truncated: boolean;
}

// One row of sqlite_master, the input of the MCP tool description (spec §7.2).
export interface TableInfo {
  name: string;
  sql: string;
}

// The RPC surface of BotObject as seen from other Workers.
// Lives here because apps cannot import each other; remote-mcp casts its untyped DO stub to this.
// Property signatures, not method signatures: the repo's oxlint enforces
// `typescript/method-signature-style`.
export interface BotRpc {
  status: () => Promise<StatusReport>;
  ensureConnected: () => Promise<StatusReport>;
  schema: () => Promise<TableInfo[]>;
  query: (sql: string) => Promise<QueryResult>;
}

export const stoppedStatus = (): StatusReport => ({
  state: "stopped",
  since: 0,
  reason: null,
  last_event_at: null,
  seq: null,
  guild_count: 0,
  reconnects_24h: 0,
  identify_remaining: null,
});
