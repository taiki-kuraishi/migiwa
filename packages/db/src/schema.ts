import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// 集計ごとに、どの時刻までの event を集計し終えたかを持つ。次の実行はこの時刻から再開する。
export const aggregationRuns = sqliteTable("aggregation_runs", {
  name: text("name").primaryKey(),
  processedUntil: integer("processed_until", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$onUpdate(() => new Date()),
});
