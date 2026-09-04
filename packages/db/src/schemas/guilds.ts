import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// One row per guild the bot can see, upserted from GUILD_CREATE.
export const guilds = sqliteTable("guilds", {
  guild_id: text().primaryKey(),
  name: text().notNull(),
  member_count: integer(),
  large: integer({ mode: "boolean" }).notNull().default(false),
  available: integer({ mode: "boolean" }).notNull().default(true),
  first_seen_at: integer().notNull(),
  last_snapshot_at: integer(),
});
