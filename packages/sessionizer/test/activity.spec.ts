import type { ActivitySlice } from "@migiwa/gateway";

import { describe, expect, test } from "bun:test";

import { activityKey, reduceActivities } from "../src/activity";
import { activityRow } from "./fixtures";

const NOW = 5000;

function game(overrides: Partial<ActivitySlice> = {}): ActivitySlice {
  return { name: "Game", type: 0, created_at: 4000, application_id: "app-1", ...overrides };
}

// `status` is a raw string here, but PresenceLike.status is Discord's PresenceUpdateReceiveStatus string enum.
// A literal string isn't assignable to it without a cast, same as presence.spec.ts.
function update(
  activities: ActivitySlice[],
  status = "online",
): Parameters<typeof reduceActivities>[1] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only fixture shape, see comment above
  return { user: { id: "u1" }, guild_id: "g1", status, activities } as Parameters<
    typeof reduceActivities
  >[1];
}

describe("activityKey", () => {
  test("prefers application_id and falls back to name", () => {
    expect(activityKey(game())).toBe("app-1");
    expect(activityKey(game({ application_id: undefined }))).toBe("Game");
  });
});

describe("reduceActivities", () => {
  test("opens a row per new activity, started at Discord's created_at", () => {
    const ops = reduceActivities([], update([game({ state: "Lobby" })]), NOW);
    expect(ops).toEqual([
      {
        kind: "open",
        table: "activity",
        row: {
          guild_id: "g1",
          user_id: "u1",
          activity_type: 0,
          activity_key: "app-1",
          application_id: "app-1",
          name: "Game",
          state: "Lobby",
          details: null,
          started_at: 4000,
        },
      },
    ]);
  });

  test("closes rows whose activity disappeared", () => {
    const row = activityRow();
    expect(reduceActivities([row], update([]), NOW)).toEqual([
      { kind: "close", table: "activity", id: row.id, ended_at: NOW, end_reason: "activity_end" },
    ]);
  });

  test("updates state and details of an activity that is still there", () => {
    const row = activityRow({ state: "Lobby" }),
      changed = update([game({ state: "Match", details: "3-1" })]),
      unchanged = update([game({ state: "Lobby" })]);
    expect(reduceActivities([row], changed, NOW)).toEqual([
      { kind: "update", table: "activity", id: row.id, patch: { state: "Match", details: "3-1" } },
    ]);
    expect(reduceActivities([row], unchanged, NOW)).toEqual([]);
  });

  test("closes everything with offline when the user goes offline", () => {
    const row = activityRow(),
      wentOffline = update([game()], "offline");
    expect(reduceActivities([row], wentOffline, NOW)).toEqual([
      { kind: "close", table: "activity", id: row.id, ended_at: NOW, end_reason: "offline" },
    ]);
  });

  test("treats (type, key) as identity so the same app in two types is two rows", () => {
    const ops = reduceActivities([], update([game({ type: 0 }), game({ type: 2 })]), NOW);
    expect(ops.map((op) => op.kind)).toEqual(["open", "open"]);
  });

  test("only looks at rows of the same guild and user", () => {
    const otherUser = activityRow({ user_id: "u2" }),
      otherGuild = activityRow({ guild_id: "g2" }),
      opsForOtherUser = reduceActivities([otherUser], update([game()]), NOW),
      opsForOtherGuild = reduceActivities([otherGuild], update([game()]), NOW);
    expect(opsForOtherUser).toEqual([
      {
        kind: "open",
        table: "activity",
        row: {
          guild_id: "g1",
          user_id: "u1",
          activity_type: 0,
          activity_key: "app-1",
          application_id: "app-1",
          name: "Game",
          state: null,
          details: null,
          started_at: 4000,
        },
      },
    ]);
    expect(opsForOtherGuild).toEqual(opsForOtherUser);
  });
});
