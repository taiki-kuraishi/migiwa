import {
  createExecutionContext,
  createScheduledController,
  listDurableObjectIds,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";

import { botStub } from "../src/bot-stub";
import worker from "../src/entry";
import { GATEWAY_KEY, readGateway } from "../src/gateway-state";
import { resetBot } from "./mock-discord/cleanup";

afterEach(resetBot);

test("the cron tick reaches the Durable Object and completes", async () => {
  const controller = createScheduledController({ scheduledTime: new Date(), cron: "* * * * *" }),
    ctx = createExecutionContext();
  await expect(worker.scheduled(controller, env, ctx)).resolves.toBeUndefined();
  await waitOnExecutionContext(ctx);
  // Proves the tick actually reached the DO, not just that scheduled() resolved.
  // The "bot" object exists in BOT's namespace, and only that one.
  expect(Array.from(await listDurableObjectIds(env.BOT), String)).toEqual([
    env.BOT.idFromName("bot").toString(),
  ]);
  // Proves ensureConnected() actually ran, not just that the DO woke up: it is what writes the
  // Gateway KV state this task adds. Wave 3 had no implementation writing it yet, so this test
  // Could only check the DO's existence. doConnect()'s synchronous prefix (before its first
  // Await) already moves status off the "stopped" default, regardless of how far the async
  // Gateway handshake got by the time scheduled() resolves.
  await runInDurableObject(botStub(env), (_instance, instanceCtx) => {
    expect(instanceCtx.storage.kv.get(GATEWAY_KEY)).not.toBeUndefined();
    expect(readGateway(instanceCtx.storage.kv, Date.now()).status).not.toBe("stopped");
  });
});
