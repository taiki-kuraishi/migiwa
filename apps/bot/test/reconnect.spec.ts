import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";

import { botStub } from "../src/bot-stub";
import { readGateway, writeGateway } from "../src/gateway-state";
import { closeLiveSocket, resetBot } from "./mock-discord/cleanup";
import { mockDiscord, waitFor } from "./mock-discord/client";

// Untested here: eviction of an object that still believes it is connected (a live,
// Non-hibernatable outbound socket forcibly dropped mid-connection). The socket to Discord can
// Never hibernate (spec §12), so evictDurableObject() hangs its full test timeout draining that
// Subrequest instead of completing — see closeLiveSocket()'s comment in mock-discord/cleanup.ts.
// Every test below closes the socket first, so the eviction they exercise only ever discards
// Already-idle in-memory state (this.connecting, a null this.socket), never a live connection.
// That gap is a property of this test harness, not of BotObject: the op-7 and ordinary-close
// Tests already exercise the same storage-driven RESUME branch that a real evict-while-connected
// Would fall back to.

const state = async () => {
    const report = await botStub(env).status();
    return report.state;
  },
  store = async () =>
    runInDurableObject(botStub(env), (_instance, ctx) => readGateway(ctx.storage.kv, Date.now())),
  expireBackoff = async () =>
    runInDurableObject(botStub(env), (_instance, ctx) => {
      const current = readGateway(ctx.storage.kv, Date.now());
      writeGateway(ctx.storage.kv, { ...current, backoff_until: Date.now() - 1 });
    }),
  resumes = async () => {
    const frames = await mockDiscord.received();
    return frames.filter((frame) => frame.op === 6);
  },
  identifies = async () => {
    const frames = await mockDiscord.received();
    return frames.filter((frame) => frame.op === 2);
  };

async function connectAndWait(): Promise<void> {
  await botStub(env).ensureConnected();
  await waitFor(async () => (await state()) === "connected");
}

afterEach(resetBot);

test("op 7 Reconnect closes the socket and resumes at once with session id and seq", async () => {
  await connectAndWait();
  await mockDiscord.send({ op: 7, s: null, t: null, d: null });
  await waitFor(async () => {
    const frames = await resumes();
    return frames.length === 1;
  });
  const frames = await resumes();
  expect(frames[0]?.d).toEqual({ token: "test-token", session_id: "sess-1", seq: 1 });
  await waitFor(async () => (await state()) === "connected");
});

// The mock only accepts a RESUME while `options.resumable` is true (see mock-discord/worker.js's
// File header for what stays untested without this): forcing it false here is the only way this
// Suite ever exercises onResumeFrame()'s rejection branch and onInvalidSession()'s resumable path.
test("op 7 Reconnect with a rejected session forgets it and identifies afresh", async () => {
  await connectAndWait();
  await mockDiscord.options({ resumable: false });
  await mockDiscord.send({ op: 7, s: null, t: null, d: null });
  await waitFor(async () => (await state()) === "backoff");
  const saved = await store();
  expect(saved.session_id).toBeNull();
  await expireBackoff();
  await runDurableObjectAlarm(botStub(env));
  await waitFor(async () => {
    const frames = await identifies();
    return frames.length === 1;
  });
  await waitFor(async () => (await state()) === "connected");
});

test("a fresh instance rebuilds from storage and resumes instead of identifying", async () => {
  await connectAndWait();
  // Eviction itself must not be what closes the socket (see the file header): close it first so
  // EvictDurableObject() only has to reset in-memory state, not drain a live socket it can't
  // Hibernate. That close is an ordinary (resumable) disconnect, so it lands the object in a
  // Short backoff with the session intact; expireBackoff() makes the next ensureConnected()
  // Deterministic instead of racing real wall-clock time against that backoff window. Eviction
  // Is still what's under test: it forces a genuinely new instance (constructor, migrations, a
  // Fresh `this.connecting`) to be the one that reads storage and decides to RESUME, not just the
  // Same instance with two fields cleared.
  await closeLiveSocket();
  await evictDurableObject(botStub(env));
  await expireBackoff();
  await botStub(env).ensureConnected();
  await waitFor(async () => {
    const frames = await resumes();
    return frames.length === 1;
  });
  expect(await identifies()).toEqual([]);
  await waitFor(async () => (await state()) === "connected");
});

test("a fatal close code stops reconnecting for an hour", async () => {
  await connectAndWait();
  await mockDiscord.close(4004, "authentication failed");
  await waitFor(async () => (await state()) === "fatal");
  const saved = await store();
  expect(saved.status_reason).toBe("authentication_failed");
  expect(saved.backoff_until).toBeGreaterThan(Date.now() + 3_500_000);
  await botStub(env).ensureConnected();
  // The mock only clears `received` when a new socket opens: still the one IDENTIFY, no RESUME.
  expect(await resumes()).toEqual([]);
  expect(await identifies()).toHaveLength(1);
});

test("an ordinary close backs off, then the alarm resumes", async () => {
  await connectAndWait();
  await mockDiscord.close(4000, "unknown error");
  await waitFor(async () => (await state()) === "backoff");
  const saved = await store();
  expect(saved.session_id).toBe("sess-1");
  await expireBackoff();
  await runDurableObjectAlarm(botStub(env));
  await waitFor(async () => {
    const frames = await resumes();
    return frames.length === 1;
  });
});

test("Invalid Session with d=false forgets the session and identifies again", async () => {
  await connectAndWait();
  await mockDiscord.send({ op: 9, s: null, t: null, d: false });
  await waitFor(async () => (await state()) === "backoff");
  const saved = await store();
  expect(saved.session_id).toBeNull();
  await expireBackoff();
  await runDurableObjectAlarm(botStub(env));
  await waitFor(async () => {
    const frames = await identifies();
    return frames.length === 1;
  });
  await waitFor(async () => (await state()) === "connected");
});

test("a session-ending close code identifies again", async () => {
  await connectAndWait();
  await mockDiscord.close(4009, "session timed out");
  await waitFor(async () => (await state()) === "backoff");
  const saved = await store();
  expect(saved.session_id).toBeNull();
});
