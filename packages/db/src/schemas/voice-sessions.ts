import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import type { EndReason } from "./end-reasons";

// One row per stay in one channel; a channel move closes the row and opens a new one.
// Flags hold the last observed value (their history is intentionally not kept).
export const voice_sessions = sqliteTable(
  "voice_sessions",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    guild_id: text().notNull(),
    user_id: text().notNull(),
    channel_id: text().notNull(),
    discord_session_id: text().notNull(),
    started_at: integer().notNull(),
    ended_at: integer(),
    end_reason: text().$type<EndReason>(),
    self_mute: integer({ mode: "boolean" }).notNull().default(false),
    self_deaf: integer({ mode: "boolean" }).notNull().default(false),
    mute: integer({ mode: "boolean" }).notNull().default(false),
    deaf: integer({ mode: "boolean" }).notNull().default(false),
    self_stream: integer({ mode: "boolean" }).notNull().default(false),
    self_video: integer({ mode: "boolean" }).notNull().default(false),
    suppress: integer({ mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    uniqueIndex("voice_sessions_open_uidx")
      .on(t.guild_id, t.user_id)
      .where(sql`${t.ended_at} IS NULL`),
  ],
);
