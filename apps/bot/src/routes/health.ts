import { Hono } from "hono";

import type { HonoEnv } from "../server";

// Liveness only: this route never consults the Durable Object (spec §7.4).
// An uptime monitor pointed here proves the Worker is serving, nothing about the gateway itself.
export const healthRoute = new Hono<HonoEnv>().get("/", (c) => c.json({ message: "ok" }));
