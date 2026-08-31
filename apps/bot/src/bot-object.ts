import type { DatabaseClient } from "@migiwa/db";

import { createDatabaseClient } from "@migiwa/db";
import migrations from "@migiwa/db/migrations";
import { DurableObject } from "cloudflare:workers";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";

export type GatewayState =
  | "stopped"
  | "connecting"
  | "connected"
  | "resuming"
  | "backoff"
  | "fatal";

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

export class BotObject extends DurableObject {
  public readonly db: DatabaseClient;

  public constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.db = createDatabaseClient(ctx.storage);
    // Every RPC below may assume the schema exists: nothing is served until this resolves.
    // Drizzle's journal makes re-running it on each restart a no-op.
    // Not awaited here: blockConcurrencyWhile already blocks every other RPC on this DO until the callback settles.
    void ctx.blockConcurrencyWhile(async () => migrate(this.db, migrations));
  }

  // The connection state machine arrives in PR B; until then the bot is honestly "stopped".
  // eslint-disable-next-line class-methods-use-this -- DO RPC dispatches only to instance methods, so this cannot become static; PR B's gateway state will make it use `this`.
  public async status(): Promise<StatusReport> {
    return {
      state: "stopped",
      since: 0,
      reason: null,
      last_event_at: null,
      seq: null,
      guild_count: 0,
      reconnects_24h: 0,
      identify_remaining: null,
    };
  }

  // Called by the cron every minute (spec §5.2). Not named `connect`: that collides with
  // Fetcher.connect on the stub.
  public async ensureConnected(): Promise<StatusReport> {
    return this.status();
  }
}
