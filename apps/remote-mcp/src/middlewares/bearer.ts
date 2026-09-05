import type { MiddlewareHandler } from "hono";

import { bearerAuth } from "hono/bearer-auth";

import type { HonoEnv } from "../server";

// Hono's bearerAuth compares in constant time (spec §7.1). The token lives in env, which
// Workers expose per request, hence the wrapper instead of a module-level bearerAuth().
// The explicit `<HonoEnv>` is required: bearerAuth's `token` option variant does not reference
// Its generic, so without it TypeScript defaults to Hono's blank Env and `c` no longer fits.
export const bearerMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) =>
  bearerAuth<HonoEnv>({ token: c.env.API_TOKEN })(c, next);
