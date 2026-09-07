import { describe, expect, test } from "bun:test";

import { reduce } from "../src/reduce";
import { activityRow, presenceRow, presenceUpdate } from "./fixtures";

describe("reduce", () => {
  test("PRESENCE_UPDATE runs the status rule and the activity rule", () => {
    const presence = presenceRow({ status: "online" }),
      activity = activityRow(),
      ops = reduce(
        { presence: [presence], activity: [activity], voice: [] },
        { t: "PRESENCE_UPDATE", d: presenceUpdate({ status: "offline", activities: [] }) },
        9000,
      );
    expect(ops).toEqual([
      { kind: "close", table: "presence", id: presence.id, ended_at: 9000, end_reason: "offline" },
      { kind: "close", table: "activity", id: activity.id, ended_at: 9000, end_reason: "offline" },
    ]);
  });

  // `status` absent takes the same presenceStatus(undefined) → null path as an explicit "offline" string; presenceStatus(undefined) is unit-tested in presence.spec.ts, but not its blast radius through both reducers.
  test("PRESENCE_UPDATE with `status` absent closes the open presence and activity rows as offline", () => {
    const presence = presenceRow({ status: "online" }),
      activity = activityRow(),
      ops = reduce(
        { presence: [presence], activity: [activity], voice: [] },
        { t: "PRESENCE_UPDATE", d: presenceUpdate({ status: undefined }) },
        9000,
      );
    expect(ops).toEqual([
      { kind: "close", table: "presence", id: presence.id, ended_at: 9000, end_reason: "offline" },
      { kind: "close", table: "activity", id: activity.id, ended_at: 9000, end_reason: "offline" },
    ]);
  });
});
