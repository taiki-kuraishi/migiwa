import { INTENTS } from "@migiwa/gateway";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test, vi } from "vitest";

import { botStub } from "../src/bot-stub";
import { readGateway, writeGateway } from "../src/gateway-state";
import { connectAndWait, POLL, state, store, waitForState } from "./helpers";
import { resetBot } from "./mock-discord/cleanup";
import { mockDiscord } from "./mock-discord/client";

afterEach(resetBot);

test("ensureConnected identifies with the fixed intents and reaches connected", async () => {
  await connectAndWait();
  const frames = await mockDiscord.received(),
    identify = frames.find((frame) => frame.op === 2),
    saved = await store();
  expect(identify?.d).toMatchObject({ token: "test-token", intents: INTENTS });
  expect(saved.session_id).toBe("sess-1");
  expect(saved.resume_gateway_url).toBe("wss://gateway-resume.discord.gg");
  expect(saved.bot_user_id).toBe("bot-1");
  expect(saved.seq).toBe(1);
  expect(saved.identify_remaining).toBe(998);
});

test("a second ensureConnected on a healthy socket is a no-op", async () => {
  await connectAndWait();
  await botStub(env).ensureConnected();
  const frames = await mockDiscord.received(),
    identifies = frames.filter((frame) => frame.op === 2);
  expect(identifies).toHaveLength(1);
  // A regression into a full reconnect would not fail received() alone: openGateway() clears it
  // On every new socket, so a fresh connection also carries exactly one IDENTIFY too.
  // Its connections() count below is what actually distinguishes a no-op from a reconnect.
  expect(await mockDiscord.connections()).toBe(1);
});

test("the alarm sends a heartbeat with the last seq and records the ACK", async () => {
  await mockDiscord.options({ heartbeatInterval: 200 });
  await connectAndWait();
  await runDurableObjectAlarm(botStub(env));
  await vi.waitFor(async () => {
    const frames = await mockDiscord.received();
    expect(frames.some((frame) => frame.op === 1 && frame.d === 1)).toBe(true);
  }, POLL);
  await vi.waitFor(async () => {
    const saved = await store();
    expect(saved.last_ack_at).not.toBeNull();
  }, POLL);
});

test("a failing GET /gateway/bot backs off instead of looping", async () => {
  await mockDiscord.options({ gatewayBotStatus: 500 });
  const report = await botStub(env).ensureConnected(),
    saved = await store();
  expect(report.state).toBe("backoff");
  expect(saved.backoff_until).toBeGreaterThan(Date.now());
  expect(saved.backoff_attempt).toBe(1);
});

test("an exhausted IDENTIFY budget waits for the reset instead of identifying", async () => {
  await mockDiscord.options({ remaining: 10 });
  const report = await botStub(env).ensureConnected();
  expect(report.state).toBe("backoff");
  expect(report.reason).toBe("identify_budget");
  expect(await mockDiscord.received()).toEqual([]);
});

// Regression test for the IDENTIFY storm: before the fix, doConnect() left the stale
// `backoff_until` from the earlier failure in place, so scheduleAlarm() (called right after the
// New socket is adopted, before HELLO arrives) picked that past deadline as the earliest wake-up
// And fired an immediate alarm that tore the handshake down with dropSocket() before HELLO/
// IDENTIFY ever completed — looping until it happened to win the race against readyDelayMs.
// The default mock (readyDelayMs: 0) answers IDENTIFY with READY synchronously, which is why the
// Storm was invisible without this delay.
test("recovering from backoff does not storm IDENTIFY before HELLO", async () => {
  await mockDiscord.options({ gatewayBotStatus: 500 });
  await botStub(env).ensureConnected();
  expect(await state()).toBe("backoff");
  await mockDiscord.options({ gatewayBotStatus: 200, readyDelayMs: 300 });
  await runInDurableObject(botStub(env), (_instance, ctx) => {
    const now = Date.now();
    writeGateway(ctx.storage.kv, {
      ...readGateway(ctx.storage.kv, now),
      backoff_until: now - 1,
    });
  });
  await runDurableObjectAlarm(botStub(env));
  await waitForState("connected");
  expect(await mockDiscord.connections()).toBe(1);
  const frames = await mockDiscord.received(),
    identifies = frames.filter((frame) => frame.op === 2);
  expect(identifies).toHaveLength(1);
});

test("a fatal close right after IDENTIFY stops reconnecting for about an hour", async () => {
  await mockDiscord.options({ closeAfterIdentify: 4014 });
  await botStub(env).ensureConnected();
  await waitForState("fatal");
  const report = await botStub(env).status(),
    saved = await store(),
    now = Date.now();
  expect(report.reason).toBe("disallowed_intents");
  expect(saved.backoff_until).toBeGreaterThan(now + 3_600_000 - 10_000);
  expect(saved.backoff_until).toBeLessThan(now + 3_600_000 + 10_000);
  // Fatal's backoff_until sits an hour out, so ensureConnected()'s `waiting` check must hold
  // It off exactly like a normal backoff would.
  await botStub(env).ensureConnected();
  expect(await mockDiscord.connections()).toBe(1);
});

test("a 401 from GET /gateway/bot is fatal without opening a socket", async () => {
  await mockDiscord.options({ gatewayBotStatus: 401 });
  const report = await botStub(env).ensureConnected();
  expect(report.state).toBe("fatal");
  expect(report.reason).toBe("authentication_failed");
  expect(await mockDiscord.connections()).toBe(0);
});
