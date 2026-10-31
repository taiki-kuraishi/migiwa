import { Result } from "better-result";

import type { BasinSqlClient } from "../../client/basin-sql-client";
import type { Db } from "../../libs/db";
import type { AggregationRunRepository } from "../../repository/aggregation-run-repository";
import type { StreamingIntervalRepository } from "../../repository/streaming-interval-repository";
import type { StreamingIntervalService } from "../../service/streaming-interval-service";

import { transaction } from "../../libs/db";
import { pendingRange } from "../../utils/pending-range";
import { AggregationRunConflictError } from "../aggregate-presence-use-case";
import { runName } from "./constants";

/**
 * Basin の PRESENCE_UPDATE の activities を時間単位で集計し、各 user が配信していた区間を Turso に書く。
 */
export class AggregateStreamingUseCase {
  private readonly db: Db;
  private readonly basin: BasinSqlClient;
  private readonly runs: AggregationRunRepository;
  private readonly intervals: StreamingIntervalRepository;
  private readonly streamings: StreamingIntervalService;

  /**
   * Transaction を張る DB、Basin SQL の client、各 table の repository、区間をつなぐ service を受け取る。
   */
  public constructor(args: {
    db: Db;
    basin: BasinSqlClient;
    runs: AggregationRunRepository;
    intervals: StreamingIntervalRepository;
    streamings: StreamingIntervalService;
  }) {
    this.db = args.db;
    this.basin = args.basin;
    this.runs = args.runs;
    this.intervals = args.intervals;
    this.streamings = args.streamings;
  }

  /**
   * 処理済みの上限時刻から、now の delayMinutes 分前を時の頭に切り捨てた時刻までを集計し、集計した範囲を返す。
   * 集計してよい時刻まで済んでいれば undefined を返し、ほかの実行が先に進めていれば何も書かずに
   * AggregationRunConflictError を返す。
   * 1. 処理済みの上限時刻を読む
   * 2. まだ集計していない時間を決める。集計してよい時刻まで済んでいれば undefined を返す
   * 3. その時間の配信の変化を読む
   * 4. 前回の処理済みの上限時刻で閉じた区間（各 user が続けていた最後の配信）を読む
   * 5. 閉じた区間から変化をつなぎ、書く区間を出す
   * 6. 処理済みの上限時刻を進め、区間を書いて、集計した範囲を返す
   */
  public async execute(args: { now: Date; delayMinutes: number }) {
    return Result.gen(async function* () {
      // Step 1: 処理済みの上限時刻を読む
      const run = yield* await this.runs.findByName({ name: runName });

      // Step 2: まだ集計していない時間を決める。集計してよい時刻まで済んでいれば undefined を返す
      const range = pendingRange({ ...args, processedUntil: run?.processedUntil });

      if (range === undefined) {
        return Result.ok(undefined);
      }

      // Step 3: その時間の配信の変化を読む
      const updates = yield* await this.basin.findStreamingUpdates(range);

      // Step 4: 前回の処理済みの上限時刻で閉じた区間（各 user が続けていた最後の配信）を読む
      const closedAtFrom = yield* await this.intervals.findEndingAt({ endedAt: range.from });

      // Step 5: 閉じた区間から変化をつなぎ、書く区間を出す
      const intervals = this.streamings.connect({ ...range, closedAtFrom, updates });

      // Step 6: 処理済みの上限時刻を進め、区間を書いて、集計した範囲を返す
      // Cron の重なりや手動の実行で同じ時間を二重に書かないよう、2 つを 1 つの transaction で書き、
      // 処理済みの上限時刻が読んだ値のままのときだけ確定する。
      yield* await transaction({
        db: this.db,
        run: async (tx) =>
          Result.gen(async function* () {
            const advanced = yield* await this.runs.advance({
              tx,
              name: runName,
              from: run?.processedUntil,
              to: range.to,
            });

            if (advanced === undefined) {
              return Result.err(
                new AggregationRunConflictError({
                  message: `Another run already aggregated streams from ${range.from.toISOString()}`,
                }),
              );
            }

            yield* await this.intervals.upsert({ tx, intervals });

            return Result.ok(undefined);
          }, this),
      });
      return Result.ok(range);
    }, this);
  }
}
