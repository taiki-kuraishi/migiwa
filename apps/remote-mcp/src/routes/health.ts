import { Hono } from "hono";

import type { HonoEnv } from "../server";

import { botStub } from "../bot-stub";

// This route is the human-facing safety net after the cron (spec §7.4).
// An uptime monitor here sees the gateway state itself, not just that this Worker is up.
export const healthRoute = new Hono<HonoEnv>().get("/", async (c) => {
  const report = await botStub(c.env).status();
  return c.json(report, report.state === "connected" ? 200 : 503);
});
