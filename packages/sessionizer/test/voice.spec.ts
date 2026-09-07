import { describe, expect, test } from "bun:test";

import { reduceVoice } from "../src/voice";
import { voiceRow } from "./fixtures";

const NOW = 5000,
  state = (channel_id: string | null, flags: Record<string, boolean> = {}) => ({
    user_id: "u1",
    session_id: "vs-2",
    channel_id,
    self_mute: false,
    self_deaf: false,
    mute: false,
    deaf: false,
    self_stream: false,
    self_video: false,
    suppress: false,
    ...flags,
  });

describe("reduceVoice", () => {
  test("no open row and no channel: nothing", () => {
    expect(reduceVoice([], "g1", state(null), NOW)).toEqual([]);
  });

  test("no open row and a channel: open", () => {
    expect(reduceVoice([], "g1", state("c1", { self_mute: true }), NOW)).toEqual([
      {
        kind: "open",
        table: "voice",
        row: {
          guild_id: "g1",
          user_id: "u1",
          channel_id: "c1",
          discord_session_id: "vs-2",
          started_at: NOW,
          self_mute: true,
          self_deaf: false,
          mute: false,
          deaf: false,
          self_stream: false,
          self_video: false,
          suppress: false,
        },
      },
    ]);
  });

  test("open row and channel null: close with leave", () => {
    const row = voiceRow();
    expect(reduceVoice([row], "g1", state(null), NOW)).toEqual([
      { kind: "close", table: "voice", id: row.id, ended_at: NOW, end_reason: "leave" },
    ]);
  });

  test("open row and another channel: close with move, then open", () => {
    const row = voiceRow({ channel_id: "c1" }),
      ops = reduceVoice([row], "g1", state("c2"), NOW);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual({
      kind: "close",
      table: "voice",
      id: row.id,
      ended_at: NOW,
      end_reason: "move",
    });
    expect(ops[1]).toMatchObject({
      kind: "open",
      table: "voice",
      row: { channel_id: "c2", started_at: NOW },
    });
  });

  test("same channel: patch only the flags that changed, nothing if none did", () => {
    const row = voiceRow({ channel_id: "c1", self_mute: false, deaf: false });
    expect(reduceVoice([row], "g1", state("c1", { self_mute: true }), NOW)).toEqual([
      { kind: "update", table: "voice", id: row.id, patch: { self_mute: true } },
    ]);
    expect(reduceVoice([row], "g1", state("c1"), NOW)).toEqual([]);
  });

  // B1: an open row for the same user in a different guild must not be mistaken for this guild's row.
  test("open row for this user in another guild: opens instead of updating that row", () => {
    const other = voiceRow({ guild_id: "g2" });
    expect(reduceVoice([other], "g1", state("c1"), NOW)).toMatchObject([
      { kind: "open", table: "voice", row: { guild_id: "g1", channel_id: "c1" } },
    ]);
  });
});
