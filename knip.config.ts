import type { KnipConfig } from "knip";

export default {
  bun: { config: ["package.json", "bunfig.toml"] },
  entry: [],
  // `apps/bot/dist/entry.d.ts` is a hand-written shim (spec D13), only reachable through
  // `worker-configuration.d.ts`'s `import("./dist/entry")` type positions.
  // Knip does not trace that edge, so the file otherwise reads as unused.
  ignore: ["apps/bot/dist/entry.d.ts"],
  project: [],
  workspaces: {
    ".": {},
    // Knip's drizzle plugin only looks for `drizzle.config.{ts,js,json}`.
    // Naming the CI-only sqlite twin here keeps it from reading as an unused file.
    "packages/db": { drizzle: { config: ["drizzle.config.ts", "drizzle.config.sqlite.ts"] } },
    "packages/mcp": {},
    // Knip only special-cases the `node:` protocol, so it reads `cloudflare:workers` and
    // `cloudflare:test` as a dependency literally named `cloudflare`.
    // `ignoreExportsUsedInFile`: constants and types exported for tests or for readability.
    // Those consumed in the same file are not dead code.
    "apps/bot": {
      ignoreDependencies: ["cloudflare"],
      ignoreExportsUsedInFile: true,
    },
    // The fake bot is loaded by vitest.config.ts through a Miniflare scriptPath.
    // Knip cannot follow that, so it is listed as an entry by hand.
    "apps/remote-mcp": {
      entry: ["test/fake-bot/worker.js"],
      ignoreDependencies: ["cloudflare"],
    },
  },
} satisfies KnipConfig;
