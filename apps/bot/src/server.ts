import { Hono } from "hono";

import { healthRoute } from "./routes/health";

export const app = new Hono<HonoEnv>().route("/health", healthRoute);

export interface HonoEnv {
  Bindings: Cloudflare.Env;
}
