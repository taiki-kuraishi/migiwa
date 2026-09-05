import {
  createExecutionContext,
  createScheduledController,
  listDurableObjectIds,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";

import worker from "../src/entry";

test("the cron tick reaches the Durable Object and completes", async () => {
  const controller = createScheduledController({ scheduledTime: new Date(), cron: "* * * * *" }),
    ctx = createExecutionContext();
  await expect(worker.scheduled(controller, env, ctx)).resolves.toBeUndefined();
  await waitOnExecutionContext(ctx);
  // Proves the tick actually reached the DO, not just that scheduled() resolved.
  // The "default" object exists in BOT's namespace, and only that one.
  expect(Array.from(await listDurableObjectIds(env.BOT), String)).toEqual([
    env.BOT.idFromName("default").toString(),
  ]);
});
