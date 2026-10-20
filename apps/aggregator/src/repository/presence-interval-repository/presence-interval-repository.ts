import { presenceIntervals } from "@migiwa/db";
import { Result } from "better-result";
import { sql } from "drizzle-orm";

import type { Db, Tx } from "../../libs/db";

import { PresenceIntervalQueryError } from "./errors";

/**
 * 各 user が各状態でいた区間を読み書きする。
 */
export class PresenceIntervalRepository {
  private readonly db: Db;

  /**
   * `createDb` で作った DB を受け取る。
   */
  public constructor(args: { db: Db }) {
    this.db = args.db;
  }

  /**
   * ちょうど endedAt で閉じた区間をすべて返す。
   */
  public async findEndingAt(args: { endedAt: Date }) {
    return Result.tryPromise({
      try: async () =>
        this.db.query.presenceIntervals.findMany({
          where: (t, operators) => operators.eq(t.endedAt, args.endedAt),
        }),
      catch: (cause) =>
        new PresenceIntervalQueryError({
          cause,
          message: `Failed to read the presence intervals ending at ${args.endedAt.toISOString()}`,
        }),
    });
  }

  /**
   * 区間を書く。同じ user・開始時刻の区間が既にあれば、終了時刻だけを延ばす。
   */
  public async upsert(args: { tx: Tx; intervals: (typeof presenceIntervals.$inferInsert)[] }) {
    // 列 started_at・ended_at は ms の整数で持つ（schema の timestamp_ms）。JSON にすると Date は文字列になるので
    // 先に変える。
    const intervals = args.intervals.map((interval) => ({
      ...interval,
      startedAt: interval.startedAt.getTime(),
      endedAt: interval.endedAt.getTime(),
    }));
    return Result.tryPromise({
      try: async () => {
        // 行ごとに bind すると SQLite の bind 変数の上限（32766 = 約 8000 行）を超えうるので、全行を 1 つの JSON
        // として bind し、json_each で行に戻す。WHERE true は SELECT から UPSERT するときの構文の曖昧さを消す。
        await args.tx.run(sql`
          INSERT INTO ${presenceIntervals} (user_id, status, started_at, ended_at)
          SELECT
            json_extract(value, '$.userId'),
            json_extract(value, '$.status'),
            json_extract(value, '$.startedAt'),
            json_extract(value, '$.endedAt')
          FROM json_each(${JSON.stringify(intervals)})
          WHERE true
          ON CONFLICT (user_id, started_at) DO UPDATE SET ended_at = excluded.ended_at
        `);
      },
      catch: (cause) =>
        new PresenceIntervalQueryError({
          cause,
          message: "Failed to save the presence intervals",
        }),
    });
  }
}
