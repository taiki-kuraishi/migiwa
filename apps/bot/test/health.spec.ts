import { createScheduledController, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, expect, test, vi } from "vitest";

import worker from "../src/entry";
import { botStub } from "../src/utils/bot-stub";
import { mockDiscord } from "./mock-discord";
import { network } from "./network";

const poll = { timeout: 10_000, interval: 20 };

let stopDiscord = () => {};

async function waitForState(state: string) {
  await vi.waitFor(async () => {
    const status = await botStub(env).status();
    expect(status.state).toBe(state);
  }, poll);
}

// 再接続で本物の Discord へ出ていかないよう、bot が止まったのを見届けてから handler を外す。
afterEach(async () => {
  await runInDurableObject(botStub(env), () => {
    stopDiscord();
  });
  await waitForState("stopped");
  network.resetHandlers();
});

test("GET /health は、cron tick が接続した bot の状態を返す", async () => {
  // Arrange
  const discord = mockDiscord({ sessionId: "session-health" });
  stopDiscord = discord.stop;
  network.use(...discord.handlers);
  await worker.scheduled(createScheduledController({ cron: "* * * * *" }), env);
  await waitForState("connected");

  // Act
  const response = await exports.default.fetch("http://bot/health");

  // Assert
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    state: "connected",
    hasSession: true,
    lastReceivedAt: expect.any(Number),
  });
});
