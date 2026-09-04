import { Hono } from "hono";

import { healthRoute } from "./routes/health";

export interface HonoEnv {
  Bindings: Cloudflare.Env;
}

// One chain on purpose: breaking it loses Hono's RPC type inference (AGENTS.md).
export const app = new Hono<HonoEnv>().route("/health", healthRoute);
