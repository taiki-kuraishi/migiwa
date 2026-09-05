import { Hono } from "hono";
import { cors } from "hono/cors";

import { bearerMiddleware } from "./middlewares/bearer";
import { healthRoute } from "./routes/health";
import { mcpRoute } from "./routes/mcp";

export interface HonoEnv {
  Bindings: Cloudflare.Env;
}

// One chain on purpose: breaking it loses Hono's RPC type inference (AGENTS.md).
// Cors runs before bearer so a preflight is answered without a token.
export const app = new Hono<HonoEnv>()
  .use(
    "/mcp",
    cors({
      origin: "*",
      allowHeaders: ["Authorization", "Content-Type", "mcp-protocol-version", "mcp-session-id"],
      exposeHeaders: ["mcp-session-id"],
    }),
  )
  // Deny by default (spec §7.1): every path, known or not, needs a bearer token except the
  // Health check, which an uptime monitor hits with no credentials of its own.
  .use("*", async (c, next) => (c.req.path === "/health" ? next() : bearerMiddleware(c, next)))
  .route("/health", healthRoute)
  .route("/mcp", mcpRoute);
