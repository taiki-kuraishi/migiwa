import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";

import { botStub } from "../src/bot-stub";
import { GATEWAY_KEY, readGateway, writeGateway } from "../src/gateway-state";
import { mockDiscord, waitFor } from "./mock-discord/client";

// `BotObject.socket` is private, but reaching into the live instance to close it directly (the
// Same pattern mock-discord/cleanup.ts's resetBot() uses) is the only way a test can end a
// Connection itself: left open, evictDurableObject() hangs draining a subrequest for a socket
// That can never hibernate (see mock-discord/worker.js's file header — this socket is a plain,
// Non-hibernatable WebSocket, same restriction as on the mock's own server side).
interface WithSocket {
  socket: WebSocket | null;
}

async function closeLiveSocket(): Promise<void> {
  await runInDurableObject(botStub(env), (instance) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test cleanup only, see WithSocket above.
    (instance as unknown as WithSocket).socket?.close();
  });
}

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

afterEach(async () => {
  await mockDiscord.reset();
  await closeLiveSocket();
  // A pending alarm would re-create the object after eviction and reconnect to a reset mock;
  // A leftover session id would turn the next test's IDENTIFY into a RESUME.
  await runInDurableObject(botStub(env), async (_instance, ctx) => {
    ctx.storage.kv.delete(GATEWAY_KEY);
    return ctx.storage.deleteAlarm();
  });
  await evictDurableObject(botStub(env));
});

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

test("after eviction the next ensureConnected resumes instead of identifying", async () => {
  await connectAndWait();
  // Eviction itself must not be what closes the socket (see the WithSocket comment above): close
  // It first so evictDurableObject() only has to reset in-memory state, not drain a live socket
  // It can't hibernate. That close is an ordinary (resumable) disconnect, so it lands the object
  // In a short backoff with the session intact; expireBackoff() makes the next ensureConnected()
  // Deterministic instead of racing real wall-clock time against that backoff window.
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
