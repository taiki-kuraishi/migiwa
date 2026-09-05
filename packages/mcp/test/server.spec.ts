import type { QueryResult } from "@migiwa/gateway";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "bun:test";

import { createMcpServer } from "../src/server";

const EMPTY: QueryResult = { columns: [], rows: [], rows_read: 0, truncated: false };

async function connect(query: (sql: string) => Promise<QueryResult>): Promise<Client> {
  const server = createMcpServer({ description: "the description", query }),
    client = new Client({ name: "test", version: "0.0.0" }),
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

describe("createMcpServer", () => {
  test("exposes exactly one tool, query, with the given description", async () => {
    const client = await connect(async () => EMPTY),
      { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["query"]);
    expect(tools[0]?.description).toBe("the description");
  });

  test("query hands the sql to the executor and returns its result as JSON text", async () => {
    const seen: string[] = [],
      client = await connect(async (sql) => {
        seen.push(sql);
        return { columns: ["1"], rows: [[1]], rows_read: 1, truncated: false };
      }),
      result = await client.callTool({ name: "query", arguments: { sql: "SELECT 1" } });
    expect(seen).toEqual(["SELECT 1"]);
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({ columns: ["1"], rows: [[1]], rows_read: 1, truncated: false }),
      },
    ]);
  });

  test("an executor error becomes an isError result, not a protocol error", async () => {
    const client = await connect(async () => {
        throw new Error("only a single SELECT / WITH / EXPLAIN statement is allowed");
      }),
      result = await client.callTool({ name: "query", arguments: { sql: "DROP TABLE x" } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("SELECT / WITH / EXPLAIN");
  });
});
