import type { ActivitySession } from "@migiwa/db";
import type { ActivitySlice, PresenceSlice } from "@migiwa/gateway";

import type { SessionOp } from "./types";

import { presenceStatus } from "./presence";

// Discord marks activity.id as unstable, so identity is (type, application_id ?? name).
export const activityKey = (activity: ActivitySlice): string =>
  activity.application_id ?? activity.name;

function identity(type: number, key: string): string {
  return `${type}:${key}`;
}

// Discord can list the same application twice (e.g. two Spotify entries); first one wins.
// One Map, keyed by identity, serves both loops in reduceActivities: `.values()` gives the deduped payload (open/update), `.has()` gives the membership check (close) — one place that can drift instead of two.
function wantedActivities(activities: ActivitySlice[]): Map<string, ActivitySlice> {
  const wanted = new Map<string, ActivitySlice>();
  for (const activity of activities) {
    const id = identity(activity.type, activityKey(activity));
    if (!wanted.has(id)) {
      wanted.set(id, activity);
    }
  }
  return wanted;
}

// Spec §6.3, PRESENCE_UPDATE / activities: a set difference between the open rows and the activities in the payload.
// Offline closes everything.
export function reduceActivities(
  open: ActivitySession[],
  d: PresenceSlice,
  received_at: number,
): SessionOp[] {
  const offline = presenceStatus(d.status) === null,
    // `d.activities` is optional; a payload without it means the empty set, so every open row below closes.
    wanted = wantedActivities(offline ? [] : (d.activities ?? [])),
    mine = open.filter((row) => row.guild_id === d.guild_id && row.user_id === d.user.id),
    ops: SessionOp[] = [];
  for (const activity of wanted.values()) {
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
          // `created_at` is required by `ActivitySlice` (D13), so there is no `received_at` fallback — a payload without it never reaches this function.
          // `started_at` is Discord's clock while `ended_at` is the Durable Object's (`received_at`), so a consumer computing durations can see skew.
          started_at: activity.created_at,
        },
      });
    } else if (row.state !== state || row.details !== details) {
      ops.push({ kind: "update", table: "activity", id: row.id, patch: { state, details } });
    }
  }
  for (const row of mine) {
    if (!wanted.has(identity(row.activity_type, row.activity_key))) {
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
