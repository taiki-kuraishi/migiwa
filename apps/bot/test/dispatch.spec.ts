import type { GuildCreateSlice, ValidatedDispatch } from "@migiwa/gateway";

import { events, guilds, presence_sessions, voice_sessions } from "@migiwa/db";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";

import type { BotObject } from "../src/bot-object";

import { botStub } from "../src/bot-stub";
import { readGateway } from "../src/gateway-state";
import { guildFilter, ingestDispatch } from "../src/ingest/dispatch";
import { connectAndWait, POLL, state } from "./helpers";
import { resetBot } from "./mock-discord/cleanup";
import { mockDiscord } from "./mock-discord/client";

const seq = async () =>
    runInDurableObject(
      botStub(env),
      (_instance, ctx) => readGateway(ctx.storage.kv, Date.now()).seq,
    ),
  rows = async <T>(pick: (instance: BotObject) => T): Promise<T> =>
    runInDurableObject(botStub(env), (instance) => pick(instance)),
  voiceState = (user_id: string, channel_id: string | null) => ({
    guild_id: "g1",
    user_id,
    session_id: `vs-${user_id}`,
    channel_id,
    self_mute: false,
    self_deaf: false,
    mute: false,
    deaf: false,
    self_video: false,
    suppress: false,
    request_to_speak_timestamp: null,
  });

afterEach(resetBot);

// `GuildCreateSlice`'s presences[].status is Discord's PresenceUpdateReceiveStatus string enum;
// A literal string isn't assignable to it without a cast (same shortcut as
// `packages/sessionizer/test/fixtures.ts`'s presenceUpdate()).
function guildCreateDispatch(guild_id: string, snapshotUserId: string): ValidatedDispatch {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only fixture shape, see comment above
  const d = {
    id: guild_id,
    name: "Guild",
    member_count: 2,
    large: false,
    presences: [{ user: { id: snapshotUserId }, status: "online", activities: [] }],
    voice_states: [],
  } as GuildCreateSlice;
  return { t: "GUILD_CREATE", s: 1, d };
}

test("guildFilter keeps everything when empty and only the listed ids otherwise", () => {
  expect(guildFilter("")("g1")).toBe(true);
  expect(guildFilter(" g1, g2 ")("g2")).toBe(true);
  expect(guildFilter("g1,g2")("g9")).toBe(false);
});

test("PRESENCE_UPDATE opens a presence session, stores the raw event and advances seq", async () => {
  await connectAndWait();
  await mockDiscord.send({
    op: 0,
    s: 2,
    t: "PRESENCE_UPDATE",
    d: {
      user: { id: "u1" },
      guild_id: "g1",
      status: "online",
      activities: [],
      client_status: { desktop: "online" },
    },
  });
  await vi.waitFor(async () => expect(await seq()).toBe(2), POLL);
  const presence = await rows((instance) =>
      instance.db
        .select()
        .from(presence_sessions)
        .where(eq(presence_sessions.guild_id, "g1"))
        .all(),
    ),
    raw = await rows((instance) =>
      instance.db.select().from(events).where(eq(events.guild_id, "g1")).all(),
    );
  expect(presence).toMatchObject([
    { guild_id: "g1", user_id: "u1", status: "online", client_desktop: "online", ended_at: null },
  ]);
  expect(raw).toMatchObject([{ type: "PRESENCE_UPDATE", guild_id: "g1", user_id: "u1", seq: 2 }]);
});

test("VOICE_STATE_UPDATE opens and then closes a voice session", async () => {
  await connectAndWait();
  await mockDiscord.send({ op: 0, s: 2, t: "VOICE_STATE_UPDATE", d: voiceState("u1", "c1") });
  await mockDiscord.send({ op: 0, s: 3, t: "VOICE_STATE_UPDATE", d: voiceState("u1", null) });
  await vi.waitFor(async () => expect(await seq()).toBe(3), POLL);
  const voice = await rows((instance) => instance.db.select().from(voice_sessions).all());
  expect(voice).toMatchObject([{ channel_id: "c1", end_reason: "leave" }]);
});

// This DO's tables persist across tests in this file (no per-test storage reset, same as
// Task 20's ingest.spec.ts), so this checks the absence of rows for this test's own guild_id
// Rather than the whole table, which earlier tests have already written to.
test("a guild outside DISCORD_GUILD_IDS only advances seq", async () => {
  await connectAndWait();
  await mockDiscord.send({
    op: 0,
    s: 2,
    t: "PRESENCE_UPDATE",
    d: { user: { id: "u1" }, guild_id: "g9", status: "online", activities: [] },
  });
  await vi.waitFor(async () => expect(await seq()).toBe(2), POLL);
  expect(
    await rows((instance) =>
      instance.db.select().from(events).where(eq(events.guild_id, "g9")).all(),
    ),
  ).toEqual([]);
  expect(
    await rows((instance) =>
      instance.db
        .select()
        .from(presence_sessions)
        .where(eq(presence_sessions.guild_id, "g9"))
        .all(),
    ),
  ).toEqual([]);
});

// `g2` (also in DISCORD_GUILD_IDS) is untouched by every other test in this file, so the whole
// Guild's presence_sessions is exactly this test's own state: if validateDispatch()'s
// Requiredness check on `user` ever regressed and let the malformed payload through,
// `ingestPresence` would open a second row here and this array would have length 2, not 1.
test("a payload without the required ids is dropped and the socket stays up", async () => {
  await connectAndWait();
  await mockDiscord.send({
    op: 0,
    s: 2,
    t: "PRESENCE_UPDATE",
    d: { guild_id: "g2", status: "online" },
  });
  await mockDiscord.send({
    op: 0,
    s: 3,
    t: "PRESENCE_UPDATE",
    d: { user: { id: "u2" }, guild_id: "g2", status: "idle", activities: [] },
  });
  await vi.waitFor(async () => expect(await seq()).toBe(3), POLL);
  expect(await state()).toBe("connected");
  const g2Presence = await rows((instance) =>
    instance.db.select().from(presence_sessions).where(eq(presence_sessions.guild_id, "g2")).all(),
  );
  expect(g2Presence).toMatchObject([{ user_id: "u2" }]);
});

// Same persistence note: presence/voice are read directly (not through loadOpenRows, the same
// Helper ingestGuildCreate calls internally — "Fixtures obtained through the code under test"),
// Scoped to this guild and `ended_at IS NULL`, so test2's/test5's now-superseded g1 rows do not
// Appear even though they are still in the table (reconciliation already closed them with
// End_reason snapshot_missing). Events has no such "open" filter, so its check is scoped to this
// Guild and event type instead. The guilds check is scoped too, even though this is currently the
// Only test writing to that table via the dispatch path.
test("GUILD_CREATE upserts the guild and opens sessions from the snapshot", async () => {
  await connectAndWait();
  await mockDiscord.send({
    op: 0,
    s: 2,
    t: "GUILD_CREATE",
    d: {
      id: "g1",
      name: "Guild",
      member_count: 3,
      large: false,
      presences: [{ user: { id: "u1" }, guild_id: "g1", status: "dnd", activities: [] }],
      voice_states: [voiceState("u2", "c1")],
    },
  });
  await vi.waitFor(async () => expect(await seq()).toBe(2), POLL);
  const openPresence = await rows((instance) =>
      instance.db
        .select()
        .from(presence_sessions)
        .where(and(eq(presence_sessions.guild_id, "g1"), isNull(presence_sessions.ended_at)))
        .all(),
    ),
    openVoice = await rows((instance) =>
      instance.db
        .select()
        .from(voice_sessions)
        .where(and(eq(voice_sessions.guild_id, "g1"), isNull(voice_sessions.ended_at)))
        .all(),
    ),
    raw = await rows((instance) =>
      instance.db
        .select()
        .from(events)
        .where(and(eq(events.guild_id, "g1"), eq(events.type, "GUILD_CREATE")))
        .all(),
    );
  expect(
    await rows((instance) =>
      instance.db.select().from(guilds).where(eq(guilds.guild_id, "g1")).all(),
    ),
  ).toMatchObject([{ guild_id: "g1", name: "Guild", member_count: 3, available: true }]);
  expect(openPresence).toMatchObject([{ user_id: "u1", status: "dnd" }]);
  expect(openVoice).toMatchObject([{ user_id: "u2", channel_id: "c1" }]);
  expect(raw).toMatchObject([
    {
      type: "GUILD_CREATE",
      guild_id: "g1",
      payload: { id: "g1", presences_count: 1, voice_states_count: 1 },
    },
  ]);
});

// Ruling 2: ingestDispatch forwards `disconnected_at` straight to reduceGuildCreate's snapshot
// Reconciliation, so a user absent from the snapshot closes at the disconnect time, not at
// `received_at`. Called directly (no socket) because onDispatch's own awaySince computation
// (snapshotDisconnectedAt) is pinned separately in gateway-state.spec.ts. u2 stays in the
// Snapshot and is asserted untouched, pinning the (guild_id, user_id) predicate per the
// "second id in fixtures" rule.
test("ingestDispatch forwards disconnected_at to the snapshot reconciliation close", async () => {
  const guildCreate = guildCreateDispatch("gdc1", "u2");
  await runInDurableObject(botStub(env), (instance) => {
    instance.db
      .insert(presence_sessions)
      .values({ guild_id: "gdc1", user_id: "u1", status: "online", started_at: 1 })
      .run();
    instance.db
      .insert(presence_sessions)
      .values({ guild_id: "gdc1", user_id: "u2", status: "online", started_at: 1 })
      .run();
    ingestDispatch(instance.db, guildCreate, 100, 5, () => true);
    const rowFor = (user_id: string) =>
      instance.db
        .select()
        .from(presence_sessions)
        .where(and(eq(presence_sessions.guild_id, "gdc1"), eq(presence_sessions.user_id, user_id)))
        .all();
    expect(rowFor("u1")).toMatchObject([{ ended_at: 5, end_reason: "snapshot_missing" }]);
    expect(rowFor("u2")).toMatchObject([{ ended_at: null }]);
  });
});

test("ingestDispatch falls back to received_at when disconnected_at is null", async () => {
  const guildCreate = guildCreateDispatch("gdc2", "u2");
  await runInDurableObject(botStub(env), (instance) => {
    instance.db
      .insert(presence_sessions)
      .values({ guild_id: "gdc2", user_id: "u1", status: "online", started_at: 1 })
      .run();
    instance.db
      .insert(presence_sessions)
      .values({ guild_id: "gdc2", user_id: "u2", status: "online", started_at: 1 })
      .run();
    ingestDispatch(instance.db, guildCreate, 100, null, () => true);
    const rowFor = (user_id: string) =>
      instance.db
        .select()
        .from(presence_sessions)
        .where(and(eq(presence_sessions.guild_id, "gdc2"), eq(presence_sessions.user_id, user_id)))
        .all();
    expect(rowFor("u1")).toMatchObject([{ ended_at: 100, end_reason: "snapshot_missing" }]);
    expect(rowFor("u2")).toMatchObject([{ ended_at: null }]);
  });
});

// Direct-call, in the style of the two tests above. `gd2` is the second guild the "second id in
// Fixtures" rule wants: it pins that GUILD_DELETE only touches the guild named in `d.id`.
// Decision 4: GUILD_DELETE writes no `events` row (deliberate asymmetry with GUILD_CREATE).
test("GUILD_DELETE (removed) closes open sessions, flips available, and writes no events row", async () => {
  await runInDurableObject(botStub(env), (instance) => {
    instance.db
      .insert(guilds)
      .values([
        { guild_id: "gd1", name: "G1", first_seen_at: 1, available: true },
        { guild_id: "gd2", name: "G2", first_seen_at: 1, available: true },
      ])
      .run();
    instance.db
      .insert(presence_sessions)
      .values([
        { guild_id: "gd1", user_id: "u1", status: "online", started_at: 1 },
        { guild_id: "gd2", user_id: "u1", status: "online", started_at: 1 },
      ])
      .run();
    const outcome = ingestDispatch(
      instance.db,
      { t: "GUILD_DELETE", s: 1, d: { id: "gd1" } },
      50,
      null,
      () => true,
    );
    expect(outcome).toBe("ingested");
    expect(instance.db.select().from(guilds).where(eq(guilds.guild_id, "gd1")).all()).toMatchObject(
      [{ available: false }],
    );
    expect(
      instance.db
        .select()
        .from(presence_sessions)
        .where(eq(presence_sessions.guild_id, "gd1"))
        .all(),
    ).toMatchObject([{ ended_at: 50, end_reason: "guild_removed" }]);
    // `gd2` (the second guild) stays untouched: pins the predicate on `d.id`.
    expect(instance.db.select().from(guilds).where(eq(guilds.guild_id, "gd2")).all()).toMatchObject(
      [{ available: true }],
    );
    expect(
      instance.db
        .select()
        .from(presence_sessions)
        .where(eq(presence_sessions.guild_id, "gd2"))
        .all(),
    ).toMatchObject([{ ended_at: null }]);
    expect(instance.db.select().from(events).where(eq(events.guild_id, "gd1")).all()).toEqual([]);
  });
});

// Spec §6.3: an outage (`unavailable: true`) still flips `guilds.available`, but leaves open
// Sessions open — the opposite of the "removed" case above.
test("GUILD_DELETE (outage) flips available but leaves open sessions open", async () => {
  await runInDurableObject(botStub(env), (instance) => {
    instance.db
      .insert(guilds)
      .values({ guild_id: "gd3", name: "G3", first_seen_at: 1, available: true })
      .run();
    instance.db
      .insert(presence_sessions)
      .values({ guild_id: "gd3", user_id: "u1", status: "online", started_at: 1 })
      .run();
    ingestDispatch(
      instance.db,
      { t: "GUILD_DELETE", s: 1, d: { id: "gd3", unavailable: true } },
      50,
      null,
      () => true,
    );
    expect(instance.db.select().from(guilds).where(eq(guilds.guild_id, "gd3")).all()).toMatchObject(
      [{ available: false }],
    );
    expect(
      instance.db
        .select()
        .from(presence_sessions)
        .where(eq(presence_sessions.guild_id, "gd3"))
        .all(),
    ).toMatchObject([{ ended_at: null }]);
  });
});

// Reads what log() actually wrote, without an unsafe assertion off console.log's `any` args:
// JSON.parse's return is narrowed by the type guard below instead of a cast. try/catch, not a
// Bare JSON.parse: a non-JSON console.log call (there are several elsewhere in this suite) must
// Be skipped, not thrown through and fail the test.
function loggedIngestLines(logSpy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return logSpy.mock.calls
    .map(([line]): unknown => {
      try {
        return JSON.parse(String(line));
      } catch {
        return undefined;
      }
    })
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
    )
    .filter((entry) => entry.event === "ingest");
}

// Split out of the test below to stay under the statement-count limit. Asserts the alarm actually
// Ran (not just that nothing new was logged) — runDurableObjectAlarm() returns false with no
// Alarm scheduled, which would make the "logs nothing" check pass vacuously.
async function expectIdleHeartbeatLogsNothing(logSpy: {
  mock: { calls: unknown[][] };
  mockClear: () => void;
}): Promise<void> {
  logSpy.mockClear();
  expect(await runDurableObjectAlarm(botStub(env))).toBe(true);
  expect(loggedIngestLines(logSpy)).toEqual([]);
}

// Pins flushCounters() being called from the top of sendHeartbeat() (spec §9): counters
// Accumulated since the last heartbeat come out as exactly one "ingest" log line, then are
// Cleared so an idle heartbeat logs nothing.
test("ingest outcomes are flushed as one ingest log line per heartbeat, then cleared", async () => {
  await mockDiscord.options({ heartbeatInterval: 200 });
  await connectAndWait();
  await mockDiscord.send({
    op: 0,
    s: 2,
    t: "PRESENCE_UPDATE",
    d: { user: { id: "u1" }, guild_id: "g1", status: "online", activities: [] },
  });
  await vi.waitFor(async () => expect(await seq()).toBe(2), POLL);
  const logSpy = vi.spyOn(console, "log"),
    triggerHeartbeat = async () => runDurableObjectAlarm(botStub(env));
  await vi.waitFor(async () => {
    await triggerHeartbeat();
    expect(loggedIngestLines(logSpy)).toHaveLength(1);
  }, POLL);
  expect(loggedIngestLines(logSpy)[0]).toMatchObject({ "PRESENCE_UPDATE:ingested": 1 });
  await expectIdleHeartbeatLogsNothing(logSpy);
  logSpy.mockRestore();
});
