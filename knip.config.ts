import type { KnipConfig } from "knip";

export default {
  bun: { config: ["package.json"] },
  entry: [],
  ignore: [],
  project: [],
  workspaces: {
    ".": {},
    // Knip only special-cases the `node:` protocol, so it reads `cloudflare:workers` and
    // `cloudflare:test` as a dependency literally named `cloudflare`.
    // Both `GatewayState` and `StatusReport` stay file-local exports in knip's eyes.
    // Nothing imports them by name — only their inferred types are used elsewhere.
    "apps/bot": {
      ignoreDependencies: ["cloudflare"],
      ignoreExportsUsedInFile: { type: true },
    },
    // Knip's drizzle plugin only looks for `drizzle.config.{ts,js,json}`.
    // Naming the CI-only sqlite twin here keeps it from reading as an unused file.
    "packages/db": { drizzle: { config: ["drizzle.config.ts", "drizzle.config.sqlite.ts"] } },
    "packages/gateway": {},
  },
} satisfies KnipConfig;
