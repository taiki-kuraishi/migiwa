import { Result } from "better-result";

import { BasinSqlClient } from "./client/basin-sql-client";
import { SecretClient } from "./client/secret-client";
import { createDb } from "./libs/db";
import { AggregationRunRepository } from "./repository/aggregation-run-repository";
import { GameIntervalRepository } from "./repository/game-interval-repository";
import { PresenceIntervalRepository } from "./repository/presence-interval-repository";
import { GameIntervalService } from "./service/game-interval-service";
import { PresenceIntervalService } from "./service/presence-interval-service";
import { AggregateGameUseCase } from "./use-case/aggregate-game-use-case";
import {
  AggregatePresenceUseCase,
  AggregationRunConflictError,
} from "./use-case/aggregate-presence-use-case";

/**
 * 集計 1 つの結果をログに残す。ほかの実行が先に進めていたなら warn にする。
 */
const logResult = (args: {
  name: string;
  // どちらの集計の Err も better-result の TaggedError で、Error と toJSON を持つ。
  result: Result<{ from: Date; to: Date } | undefined, Error & { toJSON: () => unknown }>;
}) => {
  if (args.result.isOk()) {
    console.log({ message: `Aggregated ${args.name}`, range: args.result.value ?? null });
    return;
  }

  // Cron の重なりや手動の実行で起き、先に進めた実行が同じ時間を足しているので失敗ではない。
  if (args.result.error instanceof AggregationRunConflictError) {
    console.warn({ message: args.result.error.message });
    return;
  }
  console.error({ message: `Failed to aggregate ${args.name}`, error: args.result.error.toJSON() });
};

/**
 * Secrets Store から token を読んで presence とゲームの集計を走らせ、それぞれの結果をログに残す。
 * 1. Basin SQL と Turso の token を読む。読めなければログに残して終わる
 * 2. 読んだ token で client と repository を作る
 * 3. Presence とゲームを順に集計し、結果をログに残す。片方が失敗しても、もう片方は走らせる
 */
export const aggregate = async (args: { env: Cloudflare.Env; now: Date }) => {
  // Step 1: Basin SQL と Turso の token を読む。読めなければログに残して終わる
  const tokens = await Result.gen(async function* () {
    const basin = yield* await new SecretClient({
      secret: args.env.BASIN_SQL_TOKEN,
      name: "Basin SQL token",
    }).get();
    const turso = yield* await new SecretClient({
      secret: args.env.TURSO_AUTH_TOKEN,
      name: "Turso auth token",
    }).get();
    return Result.ok({ basin, turso });
  });

  if (tokens.isErr()) {
    console.error({ message: "Failed to read the secrets", error: tokens.error.toJSON() });
    return;
  }

  // Step 2: 読んだ token で client と repository を作る
  const db = createDb({ url: args.env.TURSO_DATABASE_URL, authToken: tokens.value.turso });
  const basin = new BasinSqlClient({
    accountId: args.env.BASIN_ACCOUNT_ID,
    bucket: args.env.BASIN_BUCKET,
    token: tokens.value.basin,
  });
  const runs = new AggregationRunRepository({ db });
  const run = { now: args.now, delayMinutes: args.env.AGGREGATION_DELAY_MINUTES };

  // Step 3: Presence とゲームを順に集計し、結果をログに残す。片方が失敗しても、もう片方は走らせる
  logResult({
    name: "presence",
    result: await new AggregatePresenceUseCase({
      db,
      basin,
      runs,
      intervals: new PresenceIntervalRepository({ db }),
      presence: new PresenceIntervalService(),
    }).execute(run),
  });
  logResult({
    name: "games",
    result: await new AggregateGameUseCase({
      db,
      basin,
      runs,
      intervals: new GameIntervalRepository({ db }),
      games: new GameIntervalService(),
    }).execute(run),
  });
};
