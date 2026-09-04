import type { DatabaseClient } from "@migiwa/db";
import type { StatusReport } from "@migiwa/gateway";

import { createDatabaseClient } from "@migiwa/db";
import migrations from "@migiwa/db/migrations";
import { stoppedStatus } from "@migiwa/gateway";
import { DurableObject } from "cloudflare:workers";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";

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
}
