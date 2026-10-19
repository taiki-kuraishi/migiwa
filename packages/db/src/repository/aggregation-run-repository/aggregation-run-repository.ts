import { Result } from "better-result";

import type { Db } from "../../db";

import { aggregationRuns } from "../../schema";
import { AggregationRunQueryError } from "./errors";

/**
 * 集計ごとの実行記録（どの時刻までの event を集計し終えたか）を読み書きする。
 */
export class AggregationRunRepository {
  private readonly db: Db;

  /**
   * `createDb` で作った DB を受け取る。
   */
  public constructor(args: { db: Db }) {
    this.db = args.db;
  }

  /**
   * 集計名の実行記録を返す。まだ一度も実行していなければ undefined を返す。
   */
  public async findByName(args: { name: string }) {
    return Result.tryPromise({
      try: async () =>
        this.db.query.aggregationRuns.findFirst({ where: (t, { eq }) => eq(t.name, args.name) }),
      catch: (cause) =>
        new AggregationRunQueryError({
          cause,
          message: `Failed to read the aggregation run ${args.name}`,
        }),
    });
  }

  /**
   * 集計名の実行記録を、処理済みの上限時刻で作るか上書きし、保存した行を返す。
   */
  public async upsert(args: { name: string; processedUntil: Date }) {
    return Result.tryPromise({
      try: async () =>
        this.db
          .insert(aggregationRuns)
          .values(args)
          .onConflictDoUpdate({
            target: aggregationRuns.name,
            set: { processedUntil: args.processedUntil },
          })
          .returning()
          .get(),
      catch: (cause) =>
        new AggregationRunQueryError({
          cause,
          message: `Failed to save the aggregation run ${args.name}`,
        }),
    });
  }
}
