import { describe, expect, test } from "bun:test";

import { reduce } from "../src/reduce";
import { activityRow, presenceRow } from "./fixtures";

describe("reduce", () => {
  test("PRESENCE_UPDATE runs the status rule and the activity rule", () => {
    const presence = presenceRow({ status: "online" }),
      activity = activityRow(),
      ops = reduce(
        { presence: [presence], activity: [activity], voice: [] },
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only fixture shape: a raw "offline" string is not assignable to Discord's PresenceUpdateReceiveStatus string enum, see activity.spec.ts
        {
          t: "PRESENCE_UPDATE",
          d: { user: { id: "u1" }, guild_id: "g1", status: "offline", activities: [] },
        } as Parameters<typeof reduce>[1],
        9000,
      );
    expect(ops).toEqual([
      { kind: "close", table: "presence", id: presence.id, ended_at: 9000, end_reason: "offline" },
      { kind: "close", table: "activity", id: activity.id, ended_at: 9000, end_reason: "offline" },
    ]);
  });

  test("PRESENCE_UPDATE opens presence and activity together when nothing was open", () => {
    const ops = reduce(
      { presence: [], activity: [], voice: [] },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only fixture shape: a raw "online" string is not assignable to Discord's PresenceUpdateReceiveStatus string enum, see activity.spec.ts
      {
        t: "PRESENCE_UPDATE",
        d: {
          user: { id: "u1" },
          guild_id: "g1",
          status: "online",
          activities: [{ name: "Game", type: 0, created_at: 4000, application_id: "app-1" }],
        },
      } as Parameters<typeof reduce>[1],
      9000,
    );
    expect(ops).toEqual([
      {
        kind: "open",
        table: "presence",
        row: {
          guild_id: "g1",
          user_id: "u1",
          status: "online",
          client_desktop: null,
          client_mobile: null,
          client_web: null,
          started_at: 9000,
        },
      },
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
  });
});
