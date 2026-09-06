import type { DatabaseClient } from "@migiwa/db";
import type { QueryResult, StatusReport, TableInfo } from "@migiwa/gateway";

import { createDatabaseClient, ensureReadOnly, guilds } from "@migiwa/db";
import migrations from "@migiwa/db/migrations";
import { DurableObject } from "cloudflare:workers";
import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";

import { readGateway, toStatusReport } from "./gateway-state";
import { readOnlyExec } from "./read-only-exec";

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

  public async status(): Promise<StatusReport> {
    const now = Date.now();
    return toStatusReport(readGateway(this.ctx.storage.kv, now), this.guildCount(), now);
  }

  // Called by the cron every minute (spec §5.2). Not named `connect`: that collides with
  // Fetcher.connect on the stub.
  public async ensureConnected(): Promise<StatusReport> {
    return this.status();
  }

  private guildCount(): number {
    return (
      this.db.select({ n: count() }).from(guilds).where(eq(guilds.available, true)).get()?.n ?? 0
    );
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

  // Read-only SQL for the MCP tool (spec §7.3). Two layers: the text guard in @migiwa/db, then
  // ReadOnlyExec(), which rolls back anything that still writes. A Result cannot cross the DO
  // RPC boundary (spec D12), so an Err here becomes a throw, and the MCP tool turns that into
  // An isError response.
  public async query(sql: string): Promise<QueryResult> {
    const statement = ensureReadOnly(sql);
    if (statement.isErr()) {
      throw new Error(statement.error.message);
    }
    return readOnlyExec(this.ctx.storage, statement.value);
  }
}
