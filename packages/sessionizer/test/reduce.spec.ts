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

  test("VOICE_STATE_UPDATE runs the voice rule", () => {
    const ops = reduce(
      { presence: [], activity: [], voice: [] },
      {
        t: "VOICE_STATE_UPDATE",
        d: {
          guild_id: "g1",
          user_id: "u1",
          session_id: "vs-1",
          channel_id: "c1",
          self_mute: false,
          self_deaf: false,
          mute: false,
          deaf: false,
          self_video: false,
          suppress: false,
        },
      },
      9000,
    );
    expect(ops).toMatchObject([{ kind: "open", table: "voice", row: { channel_id: "c1" } }]);
  });

  test("VOICE_STATE_UPDATE without a guild (a DM call) is ignored", () => {
    const ops = reduce(
      { presence: [], activity: [], voice: [] },
      {
        t: "VOICE_STATE_UPDATE",
        d: {
          user_id: "u1",
          session_id: "vs-1",
          channel_id: "c1",
          self_mute: false,
          self_deaf: false,
          mute: false,
          deaf: false,
          self_video: false,
          suppress: false,
        },
      },
      9000,
    );
    expect(ops).toEqual([]);
  });
});
