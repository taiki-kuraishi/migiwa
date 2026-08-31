import type { KnipConfig } from "knip";

export default {
  bun: { config: ["package.json"] },
  entry: [],
  ignore: [],
  project: [],
  workspaces: {
    ".": {},
    // Hono is declared for the Task 3 routes.
    // The temporary src/entry.ts placeholder does not import it yet.
    // Knip only special-cases the `node:` protocol, so it reads `cloudflare:workers` and
    // `cloudflare:test` as a dependency literally named `cloudflare`.
    // `GatewayState` is exported for Task 3's `/health` route, which does not exist yet.
    "apps/bot": {
      ignoreDependencies: ["hono", "cloudflare"],
      ignoreExportsUsedInFile: { type: true },
    },
    // Knip's drizzle plugin only looks for `drizzle.config.{ts,js,json}`.
    // Naming the CI-only sqlite twin here keeps it from reading as an unused file.
    "packages/db": { drizzle: { config: ["drizzle.config.ts", "drizzle.config.sqlite.ts"] } },
    "packages/gateway": {},
  },
} satisfies KnipConfig;
