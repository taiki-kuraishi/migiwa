import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// 集計ごとに、どの時刻までの event を集計し終えたかを持つ。次の実行はこの時刻から再開する。
export const aggregationRuns = sqliteTable("aggregation_runs", {
  name: text("name").primaryKey(),
  processedUntil: integer("processed_until", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$onUpdate(() => new Date()),
});

// 各 user が各状態（online / idle / dnd / offline）でいた区間 [started_at, ended_at)。状態が変わった時刻で
// 切り、日や時間の境目では切らない。集計は処理済みの上限時刻で続いている区間を閉じ、次の回で同じ状態が続いて
// いれば ended_at を延ばす。遅れて届いた event で計算し直さない。
export const presenceIntervals = sqliteTable(
  "presence_intervals",
  {
    userId: text("user_id").notNull(),
    status: text("status", { enum: ["online", "idle", "dnd", "offline"] }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.startedAt] }),
    // 集計は毎回、前回の処理済みの上限時刻で閉じた区間を探す。
    index("presence_intervals_ended_at_idx").on(t.endedAt),
  ],
);
