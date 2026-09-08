import type {
  NewActivitySession,
  NewPresenceSession,
  NewVoiceSession,
  SessionOp,
} from "@migiwa/sessionizer";

import { presence_sessions } from "@migiwa/db";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { expect, test } from "vitest";

import { botStub } from "../src/bot-stub";
import { applyOps } from "../src/ingest/apply-ops";
import { loadOpenRows } from "../src/ingest/open-rows";

// `botStub(env)` is one Durable Object shared by every test in this file (spec §2's "one bot"
// Id), so its SQLite rows persist across tests. Each test below therefore uses its own guild_id
// To stay independent of what earlier tests left open, rather than relying on per-test storage
// Reset.
function presenceRow(overrides: Partial<NewPresenceSession> = {}): NewPresenceSession {
  return {
    guild_id: "g1",
    user_id: "u1",
    status: "online",
    client_desktop: null,
    client_mobile: null,
    client_web: null,
    started_at: 1,
    ...overrides,
  };
}

function voiceRow(overrides: Partial<NewVoiceSession> = {}): NewVoiceSession {
  return {
    guild_id: "g1",
    user_id: "u1",
    channel_id: "c1",
    discord_session_id: "vs-1",
    started_at: 1,
    self_mute: false,
    self_deaf: false,
    mute: false,
    deaf: false,
    self_stream: false,
    self_video: false,
    suppress: false,
    ...overrides,
  };
}

function openPresence(overrides: Partial<NewPresenceSession> = {}): SessionOp {
  return { kind: "open", table: "presence", row: presenceRow(overrides) };
}

function openVoice(overrides: Partial<NewVoiceSession> = {}): SessionOp {
  return { kind: "open", table: "voice", row: voiceRow(overrides) };
}

function activityRow(overrides: Partial<NewActivitySession> = {}): NewActivitySession {
  return {
    guild_id: "g1",
    user_id: "u1",
    activity_type: 0,
    activity_key: "app-1",
    application_id: "app-1",
    name: "Game",
    state: null,
    details: null,
    started_at: 1,
    ...overrides,
  };
}

function openActivity(overrides: Partial<NewActivitySession> = {}): SessionOp {
  return { kind: "open", table: "activity", row: activityRow(overrides) };
}

test("open inserts a row that loadOpenRows returns for that user, or for the guild", async () => {
  await runInDurableObject(botStub(env), (instance) => {
    applyOps(instance.db, [openPresence()]);
    expect(loadOpenRows(instance.db, "g1", "u1").presence).toMatchObject([
      { user_id: "u1", status: "online" },
    ]);
    expect(loadOpenRows(instance.db, "g1", "u2").presence).toEqual([]);
    expect(loadOpenRows(instance.db, "g2").presence).toEqual([]);
    expect(loadOpenRows(instance.db, "g1").presence).toHaveLength(1);
  });
});

test("close stamps ended_at and end_reason, and the row leaves the open set", async () => {
  await runInDurableObject(botStub(env), (instance) => {
    applyOps(instance.db, [
      openPresence({ guild_id: "gc" }),
      openPresence({ guild_id: "gc", user_id: "u2" }),
    ]);
    const [row] = loadOpenRows(instance.db, "gc", "u1").presence,
      closedRow = and(eq(presence_sessions.guild_id, "gc"), eq(presence_sessions.user_id, "u1"));
    if (row === undefined) {
      throw new Error("expected an open presence row");
    }
    applyOps(instance.db, [
      { kind: "close", table: "presence", id: row.id, ended_at: 9, end_reason: "offline" },
    ]);
    expect(loadOpenRows(instance.db, "gc", "u1").presence).toEqual([]);
    // Pins the id predicate: without `.where(eq(id, op.id))` this close would also stamp u2's row.
    expect(loadOpenRows(instance.db, "gc", "u2").presence).toMatchObject([{ status: "online" }]);
    expect(instance.db.select().from(presence_sessions).where(closedRow).all()).toMatchObject([
      { ended_at: 9, end_reason: "offline" },
    ]);
  });
});

test("update patches only the given flags", async () => {
  await runInDurableObject(botStub(env), (instance) => {
    applyOps(instance.db, [
      openVoice({ guild_id: "gu" }),
      openVoice({ guild_id: "gu", user_id: "u2" }),
    ]);
    const [row] = loadOpenRows(instance.db, "gu", "u1").voice;
    if (row === undefined) {
      throw new Error("expected an open voice row");
    }
    applyOps(instance.db, [
      { kind: "update", table: "voice", id: row.id, patch: { self_mute: true } },
    ]);
    expect(loadOpenRows(instance.db, "gu", "u1").voice).toMatchObject([
      { self_mute: true, self_deaf: false, channel_id: "c1" },
    ]);
    // Pins the id predicate: without `.where(eq(id, op.id))` this update would also patch u2's row.
    expect(loadOpenRows(instance.db, "gu", "u2").voice).toMatchObject([{ self_mute: false }]);
  });
});

// The only test that reaches the activity table: applyOpen/applyClose/applyUpdate's activity
// Branches, and loadOpenRows's activity block, are otherwise never executed.
test("activity: open, update, and close all reach the activity table and only the given id", async () => {
  await runInDurableObject(botStub(env), (instance) => {
    applyOps(instance.db, [
      openActivity({ guild_id: "ga" }),
      openActivity({ guild_id: "ga", user_id: "u2" }),
    ]);
    const [row] = loadOpenRows(instance.db, "ga", "u1").activity;
    if (row === undefined) {
      throw new Error("expected an open activity row");
    }
    applyOps(instance.db, [
      { kind: "update", table: "activity", id: row.id, patch: { state: "In queue" } },
    ]);
    expect(loadOpenRows(instance.db, "ga", "u1").activity).toMatchObject([{ state: "In queue" }]);
    // Pins the id predicate: without `.where(eq(id, op.id))` this update would also patch u2's row.
    expect(loadOpenRows(instance.db, "ga", "u2").activity).toMatchObject([{ state: null }]);

    applyOps(instance.db, [
      { kind: "close", table: "activity", id: row.id, ended_at: 9, end_reason: "activity_end" },
    ]);
    expect(loadOpenRows(instance.db, "ga", "u1").activity).toEqual([]);
    // Pins the id predicate: without `.where(eq(id, op.id))` this close would also end u2's row.
    expect(loadOpenRows(instance.db, "ga", "u2").activity).toHaveLength(1);
  });
});

test("opening twice for the same user fails on the partial unique index", async () => {
  await runInDurableObject(botStub(env), (instance) => {
    const op = openPresence({ guild_id: "gd" });
    expect(() => applyOps(instance.db, [op, op])).toThrow(/UNIQUE/);
  });
});

// A voice move or a presence status_change closes the old open row and opens a new one for the
// Same (guild_id, user_id) inside one applyOps call. All three session tables' partial unique
// Indexes (`WHERE ended_at IS NULL`) are checked statement-by-statement, so if applyOps ever
// Reordered ops (e.g. by grouping opens before closes) the open here would collide with the
// Still-open row from setup and throw UNIQUE instead of succeeding.
test("applyOps closes before it opens, even when given [close, open] for the same user", async () => {
  await runInDurableObject(botStub(env), (instance) => {
    applyOps(instance.db, [openPresence({ guild_id: "go" })]);
    const [row] = loadOpenRows(instance.db, "go", "u1").presence;
    if (row === undefined) {
      throw new Error("expected an open presence row");
    }
    expect(() =>
      applyOps(instance.db, [
        { kind: "close", table: "presence", id: row.id, ended_at: 9, end_reason: "status_change" },
        {
          kind: "open",
          table: "presence",
          row: presenceRow({ guild_id: "go", status: "idle", started_at: 9 }),
        },
      ]),
    ).not.toThrow();
    expect(loadOpenRows(instance.db, "go", "u1").presence).toMatchObject([{ status: "idle" }]);
  });
});
