import type { KnipConfig } from "knip";

export default {
  bun: { config: ["package.json"] },
  entry: [],
  // During the rebuild, the catalog is a version registry populated ahead of consumption.
  // Entries land here first, and workspaces start referencing them in a later wave.
  // Unused catalog entries are therefore expected here, not a defect.
  exclude: ["catalog"],
  ignore: [],
  project: [],
  workspaces: {
    ".": {},
    // Knip's drizzle plugin only looks for `drizzle.config.{ts,js,json}`.
    // Naming the CI-only sqlite twin here keeps it from reading as an unused file.
    "packages/db": { drizzle: { config: ["drizzle.config.ts", "drizzle.config.sqlite.ts"] } },
    // Knip only special-cases the `node:` protocol, so it reads `cloudflare:workers` and
    // `cloudflare:test` as a dependency literally named `cloudflare`.
    // `ignoreExportsUsedInFile`: constants and types exported for tests or for readability.
    // Those consumed in the same file (GATEWAY_KEY, IngestOutcome, PurgeCounts) are not dead code.
    "apps/bot": { ignoreDependencies: ["cloudflare"], ignoreExportsUsedInFile: true },
    "packages/gateway": {},
  },
} satisfies KnipConfig;
