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
    // Knip only special-cases the `node:` protocol, so it reads `cloudflare:workers` and
    // `cloudflare:test` as a dependency literally named `cloudflare`.
    // `ignoreExportsUsedInFile`: constants and types exported for tests or for readability.
    // Those consumed in the same file are not dead code.
    // The mock Discord worker is loaded by vitest.config.ts through a Miniflare scriptPath.
    // Knip cannot follow that, so it is listed as an entry by hand (mirrors apps/remote-mcp
    // Below).
    "apps/bot": {
      entry: ["test/mock-discord/worker.js"],
      ignoreDependencies: ["cloudflare"],
      ignoreExportsUsedInFile: true,
    },
    // The fake bot is loaded by vitest.config.ts through a Miniflare scriptPath.
    // Knip cannot follow that, so it is listed as an entry by hand.
    "apps/remote-mcp": {
      entry: ["test/fake-bot/worker.js"],
      ignoreDependencies: ["cloudflare"],
    },
    // `test/fixtures.ts` ships all three row builders (`presenceRow`, `activityRow`, `voiceRow`) together, but only the presence status rule lands this wave.
    // Task 17 (the activity rule) and a later voice rule are what call `activityRow` / `voiceRow`.
    // Listing the file as an entry keeps knip from reporting those two as dead exports before their consumers exist.
    "packages/sessionizer": { entry: ["test/fixtures.ts"] },
  },
} satisfies KnipConfig;
