import { INTENTS } from "@migiwa/gateway";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";

import { botStub } from "../src/bot-stub";
import { GATEWAY_KEY, readGateway } from "../src/gateway-state";
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

// `BotObject.socket` is private to the class, but reaching into the live instance to close it
// Directly (below) is the only way to end the test's connection: it runs inside the DO's own
// Persistent actor context, same as a later RPC to that instance would, so it can touch a
// Socket a previous RPC opened — the exact pattern doConnect()'s own dropSocket() relies on.
interface WithSocket {
  socket: WebSocket | null;
}

afterEach(async () => {
  await mockDiscord.reset();
  // BotObject's socket is a plain (non-hibernatable) WebSocket that only its own DO instance
  // May touch (see mock-discord/worker.js for the same restriction from the other side).
  // Left open, evictDurableObject() below hangs draining a subrequest that never completes.
  // This close runs its own onClose() handler, which reschedules an alarm — so it must happen
  // Before the cleanup below, not after, or that reschedule would undo the cleanup.
  await runInDurableObject(botStub(env), (instance) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test cleanup only, see WithSocket above.
    (instance as unknown as WithSocket).socket?.close();
  });
  // A pending alarm would re-create the object after eviction and reconnect to a reset mock;
  // A leftover session id would turn the next test's IDENTIFY into a RESUME.
  await runInDurableObject(botStub(env), async (_instance, ctx) => {
    ctx.storage.kv.delete(GATEWAY_KEY);
    return ctx.storage.deleteAlarm();
  });
  await evictDurableObject(botStub(env));
});

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
