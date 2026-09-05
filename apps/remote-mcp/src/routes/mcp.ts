import { StreamableHTTPTransport } from "@hono/mcp";
import { buildDescription, createMcpServer } from "@migiwa/mcp";
import { Hono } from "hono";

import type { HonoEnv } from "../server";

import { botStub } from "../bot-stub";

// Stateless (spec §7.2): a fresh server and transport per request, no session ids. The
// Description is rebuilt from the live sqlite_master on every request, so it never lags a
// Migration.
// POST only: this server is stateless, so GET's SSE stream has nothing to push, and
// @hono/mcp would otherwise hold that request open with a keepalive forever.
export const mcpRoute = new Hono<HonoEnv>().post("/", async (c) => {
  const bot = botStub(c.env),
    server = createMcpServer({
      description: buildDescription(await bot.schema()),
      query: async (sql) => bot.query(sql),
    }),
    transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});
