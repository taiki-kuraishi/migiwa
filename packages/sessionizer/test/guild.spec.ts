import type { GuildCreateSlice } from "@migiwa/gateway";

import { describe, expect, test } from "bun:test";

import { reduceGuildCreate, reduceGuildDelete } from "../src/guild";
import { activityRow, presenceRow, voiceRow } from "./fixtures";

const NOW = 9000,
  guild = (overrides: Partial<GuildCreateSlice> = {}): GuildCreateSlice => ({
    id: "g1",
    name: "Guild",
    member_count: 100,
    large: false,
    presences: [],
    voice_states: [],
    ...overrides,
  }),
  presence = (id: string, status = "online") => ({
    user: { id },
    guild_id: "g1",
    status,
    activities: [],
  }),
  voice = (user_id: string, channel_id: string) => ({
    user_id,
    channel_id,
    session_id: `vs-${user_id}`,
    self_mute: false,
    self_deaf: false,
    mute: false,
    deaf: false,
    self_video: false,
    suppress: false,
  });

describe("reduceGuildCreate", () => {
  test("upserts the guild and opens sessions from the snapshot", () => {
    const { guild: row, ops } = reduceGuildCreate(
      { presence: [], activity: [], voice: [] },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- presence()/voice() return loosely-typed test fixtures narrower than GuildCreateSlice's presences/voice_states element types
      guild({
        presences: [presence("u1")],
        voice_states: [voice("u1", "c1")],
      } as Partial<GuildCreateSlice>),
      NOW,
      null,
    );
    expect(row).toEqual({
      guild_id: "g1",
      name: "Guild",
      member_count: 100,
      large: false,
      available: true,
      last_snapshot_at: NOW,
    });
    expect(ops.map((op) => [op.kind, op.table])).toEqual([
      ["open", "presence"],
      ["open", "voice"],
    ]);
  });

  test("closes open rows of users missing from the snapshot with snapshot_missing", () => {
    const gone = presenceRow({ user_id: "u2" }),
      goneActivity = activityRow({ user_id: "u2" }),
      goneVoice = voiceRow({ user_id: "u3" }),
      { ops } = reduceGuildCreate(
        {
          presence: [presenceRow({ user_id: "u1" }), gone],
          activity: [goneActivity],
          voice: [goneVoice],
        },
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- presence() returns a loosely-typed test fixture narrower than GuildCreateSlice's presences element type
        guild({ presences: [presence("u1")] } as Partial<GuildCreateSlice>),
        NOW,
        null,
      );
    expect(ops).toEqual([
      {
        kind: "close",
        table: "presence",
        id: gone.id,
        ended_at: NOW,
        end_reason: "snapshot_missing",
      },
      {
        kind: "close",
        table: "activity",
        id: goneActivity.id,
        ended_at: NOW,
        end_reason: "snapshot_missing",
      },
      {
        kind: "close",
        table: "voice",
        id: goneVoice.id,
        ended_at: NOW,
        end_reason: "snapshot_missing",
      },
    ]);
  });

  // `disconnected_at` must only shift the close side (`ended_at`); the open side's `started_at` still comes from `received_at`, so mixing the two up would stamp a live open row with a stale time.
  test("uses disconnected_at as ended_at when the bot was away, but not as started_at for new opens", () => {
    const gone = presenceRow({ user_id: "u2" }),
      { ops } = reduceGuildCreate(
        { presence: [gone], activity: [], voice: [] },
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- presence() returns a loosely-typed test fixture narrower than GuildCreateSlice's presences element type
        guild({ presences: [presence("u1")] } as Partial<GuildCreateSlice>),
        NOW,
        7000,
      );
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ kind: "open", table: "presence", row: { started_at: NOW } });
    expect(ops[1]).toEqual({
      kind: "close",
      table: "presence",
      id: gone.id,
      ended_at: 7000,
      end_reason: "snapshot_missing",
    });
  });

  test("skips the presence reconciliation above 75,000 members but still reconciles voice", () => {
    const stale = presenceRow({ user_id: "u2" }),
      staleVoice = voiceRow({ user_id: "u3" }),
      { ops } = reduceGuildCreate(
        { presence: [stale], activity: [], voice: [staleVoice] },
        guild({ member_count: 80_000 }),
        NOW,
        null,
      );
    expect(ops).toEqual([
      {
        kind: "close",
        table: "voice",
        id: staleVoice.id,
        ended_at: NOW,
        end_reason: "snapshot_missing",
      },
    ]);
  });

  // 75,000 is spelled out here rather than imported from PRESENCE_SNAPSHOT_LIMIT, since importing it would source the fixture through the code under test, so a wrong constant could never fail this.
  test("still reconciles presence at exactly 75,000 members, the boundary is inclusive", () => {
    const stale = presenceRow({ user_id: "u2" }),
      { ops } = reduceGuildCreate(
        { presence: [stale], activity: [], voice: [] },
        guild({ member_count: 75_000 }),
        NOW,
        null,
      );
    expect(ops).toEqual([
      {
        kind: "close",
        table: "presence",
        id: stale.id,
        ended_at: NOW,
        end_reason: "snapshot_missing",
      },
    ]);
  });

  // `presentUsers` (from d.presences) and `voiceUsers` (from d.voice_states) are different sets.
  // A user present in the snapshot but absent from its voice_states must still have their voice row closed.
  // Using `presentUsers` for the voice reconciliation by mistake would keep it open instead.
  test("closes a voice row for a user who is present in the snapshot but not in its voice_states", () => {
    const staleVoice = voiceRow({ user_id: "u1" }),
      { ops } = reduceGuildCreate(
        { presence: [presenceRow({ user_id: "u1" })], activity: [], voice: [staleVoice] },
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- presence() returns a loosely-typed test fixture narrower than GuildCreateSlice's presences element type
        guild({ presences: [presence("u1")] } as Partial<GuildCreateSlice>),
        NOW,
        null,
      );
    expect(ops).toEqual([
      {
        kind: "close",
        table: "voice",
        id: staleVoice.id,
        ended_at: NOW,
        end_reason: "snapshot_missing",
      },
    ]);
  });

  // The reconciliation loop must scope "missing from the snapshot" to this guild's own open rows.
  // Spec §6.3: "この guild の open 行のうち、スナップショットに居ない user を close".
  // `reducePresenceStatus`/`reduceActivities`/`reduceVoice` already scope their own lookups by (guild_id, user_id) instead of trusting the caller to pre-filter `open`.
  test("does not touch another guild's open rows even though they are missing from this guild's snapshot", () => {
    const otherGuild = presenceRow({ guild_id: "g2", user_id: "u9" }),
      { ops } = reduceGuildCreate(
        { presence: [otherGuild], activity: [], voice: [] },
        guild(),
        NOW,
        null,
      );
    expect(ops).toEqual([]);
  });
});

describe("reduceGuildDelete", () => {
  test("an outage keeps every session open", () => {
    expect(
      reduceGuildDelete(
        { presence: [presenceRow()], activity: [], voice: [] },
        { id: "g1", unavailable: true },
        NOW,
      ),
    ).toEqual([]);
  });

  test("being removed closes everything with guild_removed", () => {
    const p = presenceRow(),
      a = activityRow(),
      v = voiceRow();
    expect(
      reduceGuildDelete({ presence: [p], activity: [a], voice: [v] }, { id: "g1" }, NOW),
    ).toEqual([
      { kind: "close", table: "presence", id: p.id, ended_at: NOW, end_reason: "guild_removed" },
      { kind: "close", table: "activity", id: a.id, ended_at: NOW, end_reason: "guild_removed" },
      { kind: "close", table: "voice", id: v.id, ended_at: NOW, end_reason: "guild_removed" },
    ]);
  });

  // Spec §6.3, GUILD_DELETE: "この guild の open 行を全部 close".
  // A different guild's open rows must survive this guild being removed, the same way `reduceGuildCreate`'s snapshot reconciliation only ever touches this guild's own rows.
  test("does not close another guild's open rows when this guild is removed", () => {
    const otherGuild = presenceRow({ guild_id: "g2", user_id: "u9" });
    expect(
      reduceGuildDelete({ presence: [otherGuild], activity: [], voice: [] }, { id: "g1" }, NOW),
    ).toEqual([]);
  });
});
