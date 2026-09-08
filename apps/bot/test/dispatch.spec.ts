import type { GuildCreateSlice, ValidatedDispatch } from "@migiwa/gateway";

import { events, guilds, presence_sessions, voice_sessions } from "@migiwa/db";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";

import type { BotObject } from "../src/bot-object";

import { botStub } from "../src/bot-stub";
import { readGateway } from "../src/gateway-state";
import { guildFilter, ingestDispatch } from "../src/ingest/dispatch";
import { loadOpenRows } from "../src/ingest/open-rows";
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
  const presence = await rows((instance) => instance.db.select().from(presence_sessions).all()),
    raw = await rows((instance) => instance.db.select().from(events).all());
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

// Same persistence note as above: scoped to (guild_id, user_id) so test2's leftover g1/u1 row
// Cannot make this pass by accident, per the "second id in fixtures" rule.
test("a payload without the required ids is dropped and the socket stays up", async () => {
  await connectAndWait();
  await mockDiscord.send({
    op: 0,
    s: 2,
    t: "PRESENCE_UPDATE",
    d: { guild_id: "g1", status: "online" },
  });
  await mockDiscord.send({
    op: 0,
    s: 3,
    t: "PRESENCE_UPDATE",
    d: { user: { id: "u2" }, guild_id: "g1", status: "idle", activities: [] },
  });
  await vi.waitFor(async () => expect(await seq()).toBe(3), POLL);
  expect(await state()).toBe("connected");
  const u2 = await rows((instance) =>
    instance.db
      .select()
      .from(presence_sessions)
      .where(and(eq(presence_sessions.guild_id, "g1"), eq(presence_sessions.user_id, "u2")))
      .all(),
  );
  expect(u2).toMatchObject([{ user_id: "u2" }]);
});

// Same persistence note: presence/voice are read through loadOpenRows (open rows only), so
// Test2's/test5's now-superseded g1 rows do not appear even though they are still in the table
// (Reconciliation itself already closed them by end_reason snapshot_missing). Events has no such
// "open" filter, so its check is scoped to this guild and event type instead.
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
  const open = await rows((instance) => loadOpenRows(instance.db, "g1")),
    raw = await rows((instance) =>
      instance.db
        .select()
        .from(events)
        .where(and(eq(events.guild_id, "g1"), eq(events.type, "GUILD_CREATE")))
        .all(),
    );
  expect(await rows((instance) => instance.db.select().from(guilds).all())).toMatchObject([
    { guild_id: "g1", name: "Guild", member_count: 3, available: true },
  ]);
  expect(open.presence).toMatchObject([{ user_id: "u1", status: "dnd" }]);
  expect(open.voice).toMatchObject([{ user_id: "u2", channel_id: "c1" }]);
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

// Reads what log() actually wrote, without an unsafe assertion off console.log's `any` args:
// JSON.parse's return is narrowed by the type guard below instead of a cast.
function loggedIngestLine(logSpy: {
  mock: { calls: unknown[][] };
}): Record<string, unknown> | undefined {
  return logSpy.mock.calls
    .map(([line]): unknown => JSON.parse(String(line)))
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
    )
    .find((entry) => entry.event === "ingest");
}

// Split out of the test below to stay under the statement-count limit.
async function expectIdleHeartbeatLogsNothing(logSpy: {
  mock: { calls: unknown[][] };
  mockClear: () => void;
}): Promise<void> {
  logSpy.mockClear();
  await runDurableObjectAlarm(botStub(env));
  expect(loggedIngestLine(logSpy)).toBeUndefined();
}

// Pins flushCounters() being called from sendHeartbeat() (spec §9): counters accumulated since
// The last heartbeat come out as one "ingest" log line, then are cleared so an idle heartbeat
// Logs nothing.
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
    expect(loggedIngestLine(logSpy)).toBeDefined();
  }, POLL);
  expect(loggedIngestLine(logSpy)).toMatchObject({ "PRESENCE_UPDATE:ingested": 1 });
  await expectIdleHeartbeatLogsNothing(logSpy);
  logSpy.mockRestore();
});
