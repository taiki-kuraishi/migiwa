import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import type { EndReason } from "./end-reasons";

export type PresenceStatus = "online" | "idle" | "dnd";

// One row per stretch of a single presence status for a user in a guild. An open session is
// `ended_at IS NULL`; the partial unique index is what enforces "at most one open session per
// (guild, user)" and keeps the lookup O(log n). Presence is stored per guild, as
// Discord delivers it, so a user shared by three guilds has three rows.
export const presence_sessions = sqliteTable(
  "presence_sessions",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    guild_id: text().notNull(),
    user_id: text().notNull(),
    status: text().$type<PresenceStatus>().notNull(),
    client_desktop: text(),
    client_mobile: text(),
    client_web: text(),
    started_at: integer().notNull(),
    ended_at: integer(),
    end_reason: text().$type<EndReason>(),
  },
  (t) => [
    uniqueIndex("presence_sessions_open_uidx")
      .on(t.guild_id, t.user_id)
      .where(sql`${t.ended_at} IS NULL`),
  ],
);
