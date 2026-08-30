import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Raw dispatches, kept only for RAW_EVENT_RETENTION_DAYS. `payload` is the event's `d`
// (GUILD_CREATE is trimmed before insert, see spec §6.2); stored as JSON text so the
// MCP query tool can json_extract() it.
export const events = sqliteTable(
  "events",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    received_at: integer().notNull(),
    seq: integer().notNull(),
    type: text().notNull(),
    guild_id: text().notNull(),
    user_id: text(),
    payload: text({ mode: "json" }).$type<unknown>().notNull(),
  },
  (t) => [
    index("events_guild_id_received_at_idx").on(t.guild_id, t.received_at),
    index("events_type_received_at_idx").on(t.type, t.received_at),
  ],
);
