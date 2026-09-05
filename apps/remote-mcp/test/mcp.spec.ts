import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { exports } from "cloudflare:workers";
import { expect, test } from "vitest";

// The MCP client talks to the Worker under test instead of the network.
const fetchWorker: typeof fetch = async (input, init) =>
  exports.default.fetch(new Request(input, init));

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://mcp/mcp"), {
      fetch: fetchWorker,
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

test("POST /mcp without a bearer token is 401", async () => {
  const response = await exports.default.fetch(
    new Request("http://mcp/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  );
  expect(response.status).toBe(401);
});

test("a wrong bearer token is 401 for the MCP client too", async () => {
  await expect(connect("wrong")).rejects.toThrow();
});

// Hono's bearerAuth follows RFC 6750: a header that isn't a well-formed "Bearer <token>" is
// `invalid_request` (400), distinct from a well-formed but wrong token, which is
// `invalid_token` (401, covered above). Both reject the request; neither is 200.
test("a malformed Authorization header is rejected with 400, not treated as a bearer token", async () => {
  const response = await exports.default.fetch(
    new Request("http://mcp/mcp", {
      method: "POST",
      headers: { Authorization: "Basic dGVzdA==", "Content-Type": "application/json" },
      body: "{}",
    }),
  );
  expect(response.status).toBe(400);
});

test("GET /health answers with no Authorization header at all", async () => {
  const response = await exports.default.fetch(new Request("http://mcp/health"));
  expect(response.status).not.toBe(401);
});

test("the only tool is query, its description names the tables, and it reaches the bot", async () => {
  const client = await connect("test-token"),
    { tools } = await client.listTools(),
    { content } = await client.callTool({ name: "query", arguments: { sql: "SELECT 1" } }),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SDK types content generically.
    [first] = content as { type: string; text: string }[];
  expect(tools.map((tool) => tool.name)).toEqual(["query"]);
  expect(tools[0]?.description).toContain("guilds");
  expect(JSON.parse(first?.text ?? "{}")).toMatchObject({ rows: [[1]] });
});
