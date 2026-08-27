import type { KnipConfig } from "knip";

export default {
  bun: { config: ["package.json"] },
  entry: [],
  ignore: [],
  ignoreBinaries: [".*"],
  project: [],
  // Catalog entries for PR 2+ workspaces don't exist yet, so this check is a false positive.
  rules: { catalog: "off" },
  workspaces: {
    ".": { ignoreDependencies: ["turbo"] },
    "packages/gateway": { entry: ["src/index.ts"] },
  },
} satisfies KnipConfig;
