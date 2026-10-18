import { Hono } from "hono";

import type { HonoEnv } from "../server";

import { botStub } from "../utils/bot-stub";

export const healthRoute = new Hono<HonoEnv>().get("/", async (c) =>
  c.json(await botStub(c.env).status()),
);
