import type { DatabaseClient } from "@migiwa/db";
import type { OpenRows } from "@migiwa/sessionizer";

import { activity_sessions, presence_sessions, voice_sessions } from "@migiwa/db";
import { and, eq, isNull } from "drizzle-orm";

// Open rows for one user, or for the whole guild when `user_id` is omitted (GUILD_CREATE).
// Drizzle's and() drops undefined conditions. Each lookup hits the partial unique index.
export function loadOpenRows(db: DatabaseClient, guild_id: string, user_id?: string): OpenRows {
  return {
    presence: db
      .select()
      .from(presence_sessions)
      .where(
        and(
          eq(presence_sessions.guild_id, guild_id),
          user_id === undefined ? undefined : eq(presence_sessions.user_id, user_id),
          isNull(presence_sessions.ended_at),
        ),
      )
      .all(),
    activity: db
      .select()
      .from(activity_sessions)
      .where(
        and(
          eq(activity_sessions.guild_id, guild_id),
          user_id === undefined ? undefined : eq(activity_sessions.user_id, user_id),
          isNull(activity_sessions.ended_at),
        ),
      )
      .all(),
    voice: db
      .select()
      .from(voice_sessions)
      .where(
        and(
          eq(voice_sessions.guild_id, guild_id),
          user_id === undefined ? undefined : eq(voice_sessions.user_id, user_id),
          isNull(voice_sessions.ended_at),
        ),
      )
      .all(),
  };
}
