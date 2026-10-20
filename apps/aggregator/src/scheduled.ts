import { Result } from "better-result";

import { BasinSqlClient } from "./client/basin-sql-client";
import { SecretClient } from "./client/secret-client";
import { createDb } from "./libs/db";
import { AggregationRunRepository } from "./repository/aggregation-run-repository";
import { PresenceIntervalRepository } from "./repository/presence-interval-repository";
import { PresenceIntervalService } from "./service/presence-interval-service";
import {
  AggregatePresenceUseCase,
  AggregationRunConflictError,
} from "./use-case/aggregate-presence-use-case";

/**
 * Secrets Store から token を読んで presence の集計を走らせ、結果をログに残す。
 * 1. Basin SQL と Turso の token を読む
 * 2. 読んだ token で client と repository を作り、集計を走らせる
 * 3. 結果をログに残す。ほかの実行が先に進めていたなら warn にする
 */
export const aggregatePresence = async (args: { env: Cloudflare.Env; now: Date }) => {
  const result = await Result.gen(async function* () {
    // Step 1: Basin SQL と Turso の token を読む
    const basinToken = yield* await new SecretClient({
      secret: args.env.BASIN_SQL_TOKEN,
      name: "Basin SQL token",
    }).get();
    const tursoToken = yield* await new SecretClient({
      secret: args.env.TURSO_AUTH_TOKEN,
      name: "Turso auth token",
    }).get();

    // Step 2: 読んだ token で client と repository を作り、集計を走らせる
    const db = createDb({ url: args.env.TURSO_DATABASE_URL, authToken: tursoToken });
    return new AggregatePresenceUseCase({
      db,
      basin: new BasinSqlClient({
        accountId: args.env.BASIN_ACCOUNT_ID,
        bucket: args.env.BASIN_BUCKET,
        token: basinToken,
      }),
      runs: new AggregationRunRepository({ db }),
      intervals: new PresenceIntervalRepository({ db }),
      presence: new PresenceIntervalService(),
    }).execute({ now: args.now, delayMinutes: args.env.AGGREGATION_DELAY_MINUTES });
  });

  // Step 3: 結果をログに残す。ほかの実行が先に進めていたなら warn にする
  if (result.isOk()) {
    console.log({ message: "Aggregated presence", range: result.value ?? null });
    return;
  }

  // Cron の重なりや手動の実行で起き、先に進めた実行が同じ時間を足しているので失敗ではない。
  if (result.error instanceof AggregationRunConflictError) {
    console.warn({ message: result.error.message });
    return;
  }
  console.error({ message: "Failed to aggregate presence", error: result.error.toJSON() });
};
