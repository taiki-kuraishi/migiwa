import type { KnipConfig } from "knip";

export default {
  bun: { config: ["package.json"] },
  entry: [],
  ignore: [],
  project: [],
  workspaces: {
    ".": {},
    // These deps are declared for the BotObject and Hono routes that land in
    // Task 2/3; the temporary src/entry.ts placeholder does not import them yet.
    "apps/bot": { ignoreDependencies: ["@migiwa/db", "drizzle-orm", "hono"] },
    // Knip's drizzle plugin only looks for `drizzle.config.{ts,js,json}`.
    // Naming the CI-only sqlite twin here keeps it from reading as an unused file.
    "packages/db": { drizzle: { config: ["drizzle.config.ts", "drizzle.config.sqlite.ts"] } },
    "packages/gateway": {},
  },
} satisfies KnipConfig;
