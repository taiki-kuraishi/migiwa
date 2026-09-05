import type { BotRpc } from "@migiwa/gateway";

import { env, exports } from "cloudflare:workers";
import { expect, test } from "vitest";

type FakeBot = BotRpc & { setState: (state: string) => Promise<void> };
const fakeBot = (): FakeBot =>
  // Pinned independently of src/bot-stub.ts, which this test does not call.
  // A name mismatch between the two Workers then fails here instead of passing silently.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fake bot adds setState().
  env.BOT.get(env.BOT.idFromName("default")) as unknown as FakeBot;

test("GET /health is 503 with the status report while the bot is stopped", async () => {
  const response = await exports.default.fetch(new Request("http://mcp/health"));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ state: "stopped", guild_count: 0 });
});

test("GET /health is 200 once the bot reports connected", async () => {
  await fakeBot().setState("connected");
  const response = await exports.default.fetch(new Request("http://mcp/health"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ state: "connected" });
});

test("anything else is 404", async () => {
  const response = await exports.default.fetch(new Request("http://mcp/"));
  expect(response.status).toBe(404);
});
