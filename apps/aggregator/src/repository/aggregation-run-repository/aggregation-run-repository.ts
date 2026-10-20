import { aggregationRuns } from "@migiwa/db";
import { Result } from "better-result";
import { eq, sql } from "drizzle-orm";

import type { Db, Tx } from "../../libs/db";

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
        this.db.query.aggregationRuns.findFirst({
          where: (t, operators) => operators.eq(t.name, args.name),
        }),
      catch: (cause) =>
        new AggregationRunQueryError({
          cause,
          message: `Failed to read the aggregation run ${args.name}`,
        }),
    });
  }

  /**
   * 処理済みの上限時刻が from のときだけ to に進め、進めた行を返す。from が undefined なら、まだ実行記録が
   * 無いときだけ作る。ほかの実行が先に進めていれば何も書かず undefined を返す。
   */
  public async advance(args: { tx: Tx; name: string; from: Date | undefined; to: Date }) {
    // 読んだ後に値が変わっていれば更新しない（compare-and-set）。同じ時間を二重に足さないため。読んだ時に
    // 行が無かったなら、既にある行は更新しない。
    let unchanged = sql`false`;
    if (args.from !== undefined) {
      unchanged = eq(aggregationRuns.processedUntil, args.from);
    }
    return Result.tryPromise({
      try: async () =>
        args.tx
          .insert(aggregationRuns)
          .values({ name: args.name, processedUntil: args.to })
          .onConflictDoUpdate({
            target: aggregationRuns.name,
            set: { processedUntil: args.to },
            setWhere: unchanged,
          })
          .returning()
          .get(),
      catch: (cause) =>
        new AggregationRunQueryError({
          cause,
          message: `Failed to advance the aggregation run ${args.name}`,
        }),
    });
  }
}
