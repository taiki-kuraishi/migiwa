import type { ActivitySlice } from "@migiwa/gateway";

import { describe, expect, test } from "bun:test";

import { activityKey, reduceActivities } from "../src/activity";
import { activityRow, presenceUpdate } from "./fixtures";

const NOW = 5000;

function game(overrides: Partial<ActivitySlice> = {}): ActivitySlice {
  return { name: "Game", type: 0, created_at: 4000, application_id: "app-1", ...overrides };
}

describe("activityKey", () => {
  test("prefers application_id and falls back to name", () => {
    expect(activityKey(game())).toBe("app-1");
    expect(activityKey(game({ application_id: undefined }))).toBe("Game");
  });
});

describe("reduceActivities", () => {
  test("opens a row per new activity, started at Discord's created_at", () => {
    const ops = reduceActivities(
      [],
      presenceUpdate({ activities: [game({ state: "Lobby" })] }),
      NOW,
    );
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
    expect(reduceActivities([row], presenceUpdate({ activities: [] }), NOW)).toEqual([
      { kind: "close", table: "activity", id: row.id, ended_at: NOW, end_reason: "activity_end" },
    ]);
  });

  test("closes every open activity row when `activities` is absent from the payload", () => {
    const row = activityRow();
    expect(reduceActivities([row], presenceUpdate(), NOW)).toEqual([
      { kind: "close", table: "activity", id: row.id, ended_at: NOW, end_reason: "activity_end" },
    ]);
  });

  test("updates state and details of an activity that is still there", () => {
    const row = activityRow({ state: "Lobby" }),
      changed = presenceUpdate({ activities: [game({ state: "Match", details: "3-1" })] }),
      unchanged = presenceUpdate({ activities: [game({ state: "Lobby" })] });
    expect(reduceActivities([row], changed, NOW)).toEqual([
      { kind: "update", table: "activity", id: row.id, patch: { state: "Match", details: "3-1" } },
    ]);
    expect(reduceActivities([row], unchanged, NOW)).toEqual([]);
  });

  test("closes everything with offline when the user goes offline", () => {
    const row = activityRow(),
      wentOffline = presenceUpdate({ activities: [game()], status: "offline" });
    expect(reduceActivities([row], wentOffline, NOW)).toEqual([
      { kind: "close", table: "activity", id: row.id, ended_at: NOW, end_reason: "offline" },
    ]);
  });

  test("treats (type, key) as identity so the same app in two types is two rows", () => {
    const ops = reduceActivities(
      [],
      presenceUpdate({ activities: [game({ type: 0 }), game({ type: 2 })] }),
      NOW,
    );
    expect(ops.map((op) => op.kind)).toEqual(["open", "open"]);
  });

  test("only looks at rows of the same guild and user", () => {
    const otherUser = activityRow({ user_id: "u2" }),
      otherGuild = activityRow({ guild_id: "g2" }),
      opsForOtherUser = reduceActivities(
        [otherUser],
        presenceUpdate({ activities: [game()] }),
        NOW,
      ),
      opsForOtherGuild = reduceActivities(
        [otherGuild],
        presenceUpdate({ activities: [game()] }),
        NOW,
      );
    expect(opsForOtherUser.map((op) => op.kind)).toEqual(["open"]);
    expect(opsForOtherGuild.map((op) => op.kind)).toEqual(["open"]);
  });

  // Discord can list the same application twice in one payload (e.g. two Spotify entries).
  // A duplicate `open` op would violate activity_sessions_open_uidx (packages/db); it must dedupe.
  test("keeps only the first activity when Discord lists the same (type, key) twice", () => {
    const ops = reduceActivities(
      [],
      presenceUpdate({ activities: [game({ state: "First" }), game({ state: "Second" })] }),
      NOW,
    );
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
          state: "First",
          details: null,
          started_at: 4000,
        },
      },
    ]);
  });

  test("keeps the first activity's state when an existing row's key is listed twice, and does not close it", () => {
    const row = activityRow({ state: "Lobby" }),
      ops = reduceActivities(
        [row],
        presenceUpdate({ activities: [game({ state: "First" }), game({ state: "Second" })] }),
        NOW,
      );
    expect(ops).toEqual([
      { kind: "update", table: "activity", id: row.id, patch: { state: "First", details: null } },
    ]);
  });
});
