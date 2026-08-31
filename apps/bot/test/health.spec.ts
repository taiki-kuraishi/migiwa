import { exports } from "cloudflare:workers";
import { expect, test } from "vitest";

test("GET /health is 200 with a fixed liveness body", async () => {
  const response = await exports.default.fetch(new Request("http://bot/health"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ message: "ok" });
});

test("anything else is 404", async () => {
  const response = await exports.default.fetch(new Request("http://bot/"));
  expect(response.status).toBe(404);
});
