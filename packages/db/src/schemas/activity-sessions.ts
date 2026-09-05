import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import type { EndReason } from "./end-reasons";

// One row per stretch of a single activity.
// `activity_key` is application_id when present, else name: Discord marks activity.id as unstable, so it is never used for identity.
export const activity_sessions = sqliteTable(
  "activity_sessions",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    guild_id: text().notNull(),
    user_id: text().notNull(),
    activity_type: integer().notNull(),
    activity_key: text().notNull(),
    application_id: text(),
    name: text().notNull(),
    state: text(),
    details: text(),
    started_at: integer().notNull(),
    ended_at: integer(),
    end_reason: text().$type<EndReason>(),
  },
  (t) => [
    uniqueIndex("activity_sessions_open_uidx")
      .on(t.guild_id, t.user_id, t.activity_type, t.activity_key)
      .where(sql`${t.ended_at} IS NULL`),
  ],
);
