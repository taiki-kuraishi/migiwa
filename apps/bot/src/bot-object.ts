import type { DatabaseClient } from "@migiwa/db";
import type { QueryResult, StatusReport, TableInfo } from "@migiwa/gateway";

import { createDatabaseClient, ensureReadOnly } from "@migiwa/db";
import migrations from "@migiwa/db/migrations";
import { stoppedStatus } from "@migiwa/gateway";
import { DurableObject } from "cloudflare:workers";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";

// Rows a single query() may return (spec §7.3).
const MAX_ROWS = 10_000;

// Read-only guard for query() (spec D12) as its own function: a Result cannot cross the DO RPC
// Boundary, so Err becomes a throw here, and the MCP tool turns that into an isError response.
// Kept separate from query() itself so query()'s own body has no declaration split by a guard
// Clause, which the repo's one-var lint rule does not tolerate.
function toReadOnlyStatement(sql: string): string {
  const statement = ensureReadOnly(sql);
  if (statement.isErr()) {
    throw new Error(statement.error.message);
  }
  return statement.value;
}

// Split out of query() to stay under the repo's max-statements lint budget.
// Stops reading the cursor past MAX_ROWS instead of collecting everything and slicing, so an
// Oversized result does not pull every row out of SQLite just to discard most of them.
function collectRows(cursor: SqlStorageCursor<Record<string, SqlStorageValue>>): {
  rows: SqlStorageValue[][];
  truncated: boolean;
} {
  const rows: SqlStorageValue[][] = [];
  let truncated = false;
  for (const row of cursor.raw()) {
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
    rows.push(row);
  }
  return { rows, truncated };
}

export class BotObject extends DurableObject {
  public readonly db: DatabaseClient;

  public constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.db = createDatabaseClient(ctx.storage);
    // Every RPC may assume the schema exists:
    // `blockConcurrencyWhile` holds every other call on this object until the callback settles.
    // Drizzle's journal makes re-running it on each restart a no-op.
    void ctx.blockConcurrencyWhile(async () => migrate(this.db, migrations));
  }

  // The gateway client arrives in wave 7; until then the bot is honestly "stopped".
  // oxlint-disable-next-line class-methods-use-this -- DO RPC dispatches to instance methods only.
  public async status(): Promise<StatusReport> {
    return stoppedStatus();
  }

  // Called by the cron every minute (spec §5.2). Not named `connect`: that collides with
  // Fetcher.connect on the stub.
  public async ensureConnected(): Promise<StatusReport> {
    return this.status();
  }

  // Feeds the MCP tool description (spec §7.2): user tables only, without SQLite's own tables,
  // Drizzle's journal and workerd's `_cf_*` internals.
  public async schema(): Promise<TableInfo[]> {
    // `exec`'s generic requires an index signature, which the shared `TableInfo` interface
    // Does not declare; the intersection satisfies it without loosening the public type.
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
    const cursor = this.ctx.storage.sql.exec(toReadOnlyStatement(sql)),
      { rows, truncated } = collectRows(cursor);
    return { columns: cursor.columnNames, rows, rows_read: cursor.rowsRead, truncated };
  }
}
