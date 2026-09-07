import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
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
// No test below calls evictDurableObject() for this reason. The storage-driven RESUME branch a
// Real evict-while-connected would fall back to is still covered — by the op-7, ordinary-close,
// And ensureConnected tests below, each driving it from a different caller, always through a
// Socket that's already closed rather than a live one.

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
  // Constrains dropSocket()'s close code: 1000/1001 instead of RECONNECT_CLOSE_CODE would flip
  // The mock's `resumable` to false (see worker.js's onSocketClose()), rejecting this RESUME and
  // Forcing a fallback IDENTIFY once the backoff it lands in gets driven forward.
  expect(await identifies()).toEqual([]);
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

test("ensureConnected recovers a backed-off connection with a RESUME, not only the alarm", async () => {
  await connectAndWait();
  // An ordinary (resumable) disconnect: lands the object in a short backoff with the session
  // Intact. expireBackoff() makes the next ensureConnected() deterministic instead of racing
  // Real wall-clock time against that window. Unlike "an ordinary close backs off, then the
  // Alarm resumes" below, nothing here calls runDurableObjectAlarm(): this is the cron
  // Watchdog's own entry point recovering the connection, a different caller than the alarm.
  await closeLiveSocket();
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
