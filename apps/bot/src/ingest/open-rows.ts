import type { DatabaseClient } from "@migiwa/db";
import type { OpenRows } from "@migiwa/sessionizer";

import { activity_sessions, presence_sessions, voice_sessions } from "@migiwa/db";
import { and, eq, isNull } from "drizzle-orm";

type SessionTable = typeof presence_sessions | typeof activity_sessions | typeof voice_sessions;

// Open rows for one user, or for the whole guild when `user_id` is omitted (GUILD_CREATE).
// Drizzle's and() drops undefined conditions. Each lookup hits the partial unique index.
export function loadOpenRows(db: DatabaseClient, guild_id: string, user_id?: string): OpenRows {
  const open = <T extends SessionTable>(t: T) =>
    db
      .select()
      .from(t)
      .where(
        and(
          eq(t.guild_id, guild_id),
          user_id === undefined ? undefined : eq(t.user_id, user_id),
          isNull(t.ended_at),
        ),
      )
      .all();
  return {
    presence: open(presence_sessions),
    activity: open(activity_sessions),
    voice: open(voice_sessions),
  };
}
