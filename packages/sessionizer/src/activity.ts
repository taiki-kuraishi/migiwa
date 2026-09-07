import type { ActivitySession } from "@migiwa/db";
import type { ActivitySlice } from "@migiwa/gateway";

import type { PresenceLike, SessionOp } from "./types";

import { presenceStatus } from "./presence";

// Discord marks activity.id as unstable, so identity is (type, application_id ?? name).
export const activityKey = (activity: ActivitySlice): string =>
  activity.application_id ?? activity.name;

// Not an arrow-function const: oxlint's `one-var` would then require merging this with the
// exported `activityKey` const above into a single statement, which would export it too.
function identity(type: number, key: string): string {
  return `${type}:${key}`;
}

// Discord can list the same application twice (e.g. two Spotify entries); first one wins.
function dedupeActivities(activities: ActivitySlice[]): ActivitySlice[] {
  const seen = new Set<string>();
  return activities.filter((activity) => {
    const id = identity(activity.type, activityKey(activity));
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

// Spec §6.3, PRESENCE_UPDATE / activities: a set difference between the open rows and the activities in the payload.
// Offline closes everything.
export function reduceActivities(
  open: ActivitySession[],
  d: PresenceLike,
  received_at: number,
): SessionOp[] {
  const offline = presenceStatus(d.status) === null,
    wanted = dedupeActivities(offline ? [] : (d.activities ?? [])),
    mine = open.filter((row) => row.guild_id === d.guild_id && row.user_id === d.user.id),
    wantedIds = new Set(wanted.map((activity) => identity(activity.type, activityKey(activity)))),
    ops: SessionOp[] = [];
  for (const activity of wanted) {
    const key = activityKey(activity),
      id = identity(activity.type, key),
      row = mine.find((r) => identity(r.activity_type, r.activity_key) === id),
      state = activity.state ?? null,
      details = activity.details ?? null;
    if (row === undefined) {
      ops.push({
        kind: "open",
        table: "activity",
        row: {
          guild_id: d.guild_id,
          user_id: d.user.id,
          activity_type: activity.type,
          activity_key: key,
          application_id: activity.application_id ?? null,
          name: activity.name,
          state,
          details,
          started_at: activity.created_at,
        },
      });
    } else if (row.state !== state || row.details !== details) {
      ops.push({ kind: "update", table: "activity", id: row.id, patch: { state, details } });
    }
  }
  for (const row of mine) {
    if (!wantedIds.has(identity(row.activity_type, row.activity_key))) {
      ops.push({
        kind: "close",
        table: "activity",
        id: row.id,
        ended_at: received_at,
        end_reason: offline ? "offline" : "activity_end",
      });
    }
  }
  return ops;
}
