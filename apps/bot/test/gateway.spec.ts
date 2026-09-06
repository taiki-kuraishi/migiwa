import { INTENTS } from "@migiwa/gateway";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";

import { botStub } from "../src/bot-stub";
import { readGateway } from "../src/gateway-state";
import { resetBot } from "./mock-discord/cleanup";
import { mockDiscord, waitFor } from "./mock-discord/client";

const state = async () => {
    const report = await botStub(env).status();
    return report.state;
  },
  store = async () =>
    runInDurableObject(botStub(env), (_instance, ctx) => readGateway(ctx.storage.kv, Date.now()));

async function connectAndWait(): Promise<void> {
  await botStub(env).ensureConnected();
  await waitFor(async () => (await state()) === "connected");
}

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
  await waitFor(async () => {
    const frames = await mockDiscord.received();
    return frames.some((frame) => frame.op === 1 && frame.d === 1);
  });
  await waitFor(async () => {
    const saved = await store();
    return saved.last_ack_at !== null;
  });
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
