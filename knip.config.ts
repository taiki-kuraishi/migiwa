import type { KnipConfig } from "knip";

export default {
  bun: { config: ["package.json"] },
  entry: [],
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
    // Those consumed in the same file are not dead code.
    "apps/bot": {
      ignoreDependencies: ["cloudflare"],
      ignoreExportsUsedInFile: true,
    },
    // `@ttsc/unplugin` is only referenced by name inside `bunfig.toml`'s `[test] preload`
    // (the `bun-register` subpath), which knip does not parse as a dependency usage site.
    "packages/gateway": { ignoreDependencies: ["@ttsc/unplugin"] },
  },
} satisfies KnipConfig;
