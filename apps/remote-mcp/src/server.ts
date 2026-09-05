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
  .use("/mcp", bearerMiddleware)
  .route("/health", healthRoute)
  .route("/mcp", mcpRoute);
