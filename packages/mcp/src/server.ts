import type { QueryResult } from "@migiwa/gateway";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface McpDeps {
  description: string;
  query: (sql: string) => Promise<QueryResult>;
}

// Exactly one tool (spec D7).
// The description is what teaches the model the schema.
// So the caller builds it from the live sqlite_master and passes it in.
export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: "migiwa", version: "1.0.0" });
  server.registerTool(
    "query",
    { description: deps.description, inputSchema: { sql: z.string() } },
    async ({ sql }) => {
      try {
        const result = await deps.query(sql);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: "text", text }] };
      }
    },
  );
  return server;
}
