import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test, vi } from "vitest";

import { botStub } from "../src/bot-stub";
import { readGateway, writeGateway } from "../src/gateway-state";
import { connectAndWait, identifies, POLL, resumes, state, store, waitForState } from "./helpers";
import { closeLiveSocket, resetBot } from "./mock-discord/cleanup";
import { mockDiscord } from "./mock-discord/client";

// Untested here: eviction of an object that still believes it is connected (a live,
// Non-hibernatable outbound socket forcibly dropped mid-connection). The socket to Discord can
// Never hibernate (spec §12), so evictDurableObject() on such an object hangs its full test
// Timeout draining that subrequest instead of completing — see closeLiveSocket()'s comment in
// Mock-discord/cleanup.ts. Every eviction below therefore closes the socket first: "after a
// Closed socket and an eviction, ensureConnected resumes with the stored seq" is the one that
// Exercises evictDurableObject() itself; the others (op-7, ordinary-close, ensureConnected
// Recovery) cover the same storage-driven RESUME branch without evicting at all.

const expireBackoff = async () =>
  runInDurableObject(botStub(env), (_instance, ctx) => {
    const current = readGateway(ctx.storage.kv, Date.now());
    writeGateway(ctx.storage.kv, { ...current, backoff_until: Date.now() - 1 });
  });

afterEach(resetBot);

test("op 7 Reconnect closes the socket and resumes at once with session id and seq", async () => {
  await connectAndWait();
  await mockDiscord.send({ op: 7, s: null, t: null, d: null });
  await vi.waitFor(async () => expect(await resumes()).toHaveLength(1), POLL);
  const frames = await resumes();
  expect(frames[0]?.d).toEqual({ token: "test-token", session_id: "sess-1", seq: 1 });
  // Constrains doConnect()'s RESUME branch to actually dial `resume_gateway_url`: the mock
  // Routes every `*.discord.gg` host to the same DO, so nothing else here would notice a RESUME
  // Wrongly opened against the plain gateway host instead.
  expect(await mockDiscord.hosts()).toEqual(["gateway.discord.gg", "gateway-resume.discord.gg"]);
  await waitForState("connected");
  // Constrains dropSocket()'s close code: 1000/1001 instead of RECONNECT_CLOSE_CODE would flip
  // The mock's `resumable` to false (see worker.js's close listener), rejecting this RESUME and
  // Forcing a fallback IDENTIFY once the backoff it lands in gets driven forward.
  expect(await identifies()).toEqual([]);
});

// The mock only accepts a RESUME while `options.resumable` is true (see mock-discord/worker.js's
// File header for what stays untested without this): forcing it false here is the only way this
// Suite ever exercises onResumeFrame's rejection branch. The op 9 `d: false` it triggers then
// Drives onInvalidSession() through its non-resumable path, the same one "Invalid Session with
// D=false forgets the session and identifies again" below exercises directly.
test("op 7 Reconnect with a rejected session forgets it and identifies afresh", async () => {
  await connectAndWait();
  await mockDiscord.options({ resumable: false });
  await mockDiscord.send({ op: 7, s: null, t: null, d: null });
  await waitForState("backoff");
  const saved = await store();
  expect(saved.session_id).toBeNull();
  await expireBackoff();
  await runDurableObjectAlarm(botStub(env));
  await vi.waitFor(async () => expect(await identifies()).toHaveLength(1), POLL);
  await waitForState("connected");
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
  await vi.waitFor(async () => expect(await resumes()).toHaveLength(1), POLL);
  expect(await identifies()).toEqual([]);
  await waitForState("connected");
});

test("after a closed socket and an eviction, ensureConnected resumes with the stored seq", async () => {
  await connectAndWait();
  await closeLiveSocket();
  await evictDurableObject(botStub(env));
  await expireBackoff();
  await botStub(env).ensureConnected();
  await vi.waitFor(async () => expect(await resumes()).toHaveLength(1), POLL);
  const frames = await resumes();
  expect(frames[0]?.d).toEqual({ token: "test-token", session_id: "sess-1", seq: 1 });
  expect(await identifies()).toEqual([]);
});

// Regression test for ruling 3 (backoff_until cleared on the RESUME write in doConnect(),
// Mirroring gateway.spec.ts's "recovering from backoff does not storm IDENTIFY before HELLO"):
// Without that clear, scheduleAlarm() (called by alarm() right after beginConnect() resolves,
// Before RESUMED arrives) picks the still-stale past deadline as the earliest wake-up and spins
// The alarm for the whole resumedDelayMs window instead of waiting for RESUMED. The spin itself
// Is checked directly (backoff_until while still "resuming"), not via connections()/resumes():
// Alarm()'s own `!open` guard blocks a second doConnect() no matter what backoff_until says once
// The resume socket is already adopted, so a spin here never produces an extra connection or
// Frame to assert on — resumedDelayMs only widens the window this check reads during.
test("recovering from backoff does not storm RESUME before RESUMED", async () => {
  await connectAndWait();
  await mockDiscord.close(4000, "unknown error");
  await waitForState("backoff");
  await mockDiscord.options({ resumedDelayMs: 300 });
  await expireBackoff();
  await runDurableObjectAlarm(botStub(env));
  await waitForState("resuming");
  const saved = await store();
  expect(saved.backoff_until).toBeNull();
  expect(await mockDiscord.connections()).toBe(2);
});

test("a fatal close code stops reconnecting for an hour", async () => {
  await connectAndWait();
  await mockDiscord.close(4004, "authentication failed");
  await waitForState("fatal");
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
  await waitForState("backoff");
  const saved = await store();
  expect(saved.session_id).toBe("sess-1");
  await expireBackoff();
  await runDurableObjectAlarm(botStub(env));
  await vi.waitFor(async () => expect(await resumes()).toHaveLength(1), POLL);
});

// Zombie branch (spec §5.5): a heartbeat goes unacked, isZombie() trips on the next due
// Heartbeat, and the close code chosen there (RECONNECT_CLOSE_CODE = 4000) must keep the
// Session resumable. ackHeartbeats: false makes the mock never answer op 1, the only way this
// Suite exercises that mock option. The predicate re-fires the alarm every poll tick: the first
// Heartbeat send is not itself due immediately (heartbeatOnHello jitters it), and isZombie()
// Only trips once a further full interval has passed unacked.
test("a missed heartbeat ACK closes with 4000 and resumes", async () => {
  await mockDiscord.options({ heartbeatInterval: 200, ackHeartbeats: false });
  await connectAndWait();
  await vi.waitFor(async () => {
    await runDurableObjectAlarm(botStub(env));
    expect(await state()).toBe("backoff");
  }, POLL);
  const saved = await store();
  expect(saved.session_id).toBe("sess-1");
  expect(await mockDiscord.closeCodes()).toEqual([4000]);
  await expireBackoff();
  await runDurableObjectAlarm(botStub(env));
  await vi.waitFor(async () => expect(await resumes()).toHaveLength(1), POLL);
});

test("Invalid Session with d=false forgets the session and identifies again", async () => {
  await connectAndWait();
  await mockDiscord.send({ op: 9, s: null, t: null, d: false });
  await waitForState("backoff");
  const saved = await store();
  expect(saved.session_id).toBeNull();
  await expireBackoff();
  await runDurableObjectAlarm(botStub(env));
  await vi.waitFor(async () => expect(await identifies()).toHaveLength(1), POLL);
  await waitForState("connected");
});

// Mutation check (B1): replacing the resumable-ternary session read with an unconditional
// ClearSession() would still pass every other test in this file; only asserting the session
// Survives here catches it.
test("op 9 Invalid Session with d: true keeps the session and resumes", async () => {
  await connectAndWait();
  await mockDiscord.send({ op: 9, s: null, t: null, d: true });
  await waitForState("backoff");
  const saved = await store();
  expect(saved.session_id).toBe("sess-1");
  await expireBackoff();
  await runDurableObjectAlarm(botStub(env));
  await vi.waitFor(async () => expect(await resumes()).toHaveLength(1), POLL);
  expect(await identifies()).toEqual([]);
  await waitForState("connected");
});

// A1: an IDENTIFY-only close code (4003/4007/4009) discards the session and waits Discord's
// 1-5 s invalid-session delay, not the exponential backoff other close codes get. backoff_attempt
// Staying 0 is the deterministic half of that check: backoffDelayMs's own range (750-1250 ms at
// Attempt 0) overlaps the 1-5 s window, so the delay bound alone would not catch every mutation
// Back to the exponential path, but that path always bumps backoff_attempt and this one never does.
test("an identify-only close code discards the session and identifies after the invalid-session delay", async () => {
  await connectAndWait();
  await mockDiscord.close(4009, "session timed out");
  await waitForState("backoff");
  const saved = await store(),
    delay = (saved.backoff_until ?? 0) - Date.now();
  expect(saved.session_id).toBeNull();
  expect(saved.backoff_attempt).toBe(0);
  // One assertion, not two: max-statements leaves no room for separate lower/upper checks here.
  expect(delay > 900 && delay <= 5000).toBe(true);
  await expireBackoff();
  await runDurableObjectAlarm(botStub(env));
  await vi.waitFor(async () => expect(await identifies()).toHaveLength(1), POLL);
});
