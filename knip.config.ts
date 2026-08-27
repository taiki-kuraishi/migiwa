import type { KnipConfig } from "knip";

export default {
  bun: { config: ["package.json"] },
  entry: [],
  ignore: [],
  ignoreBinaries: [".*"],
  project: [],
  workspaces: {
    ".": { ignoreDependencies: ["turbo"] },
    "packages/gateway": { entry: ["src/index.ts"] },
  },
} satisfies KnipConfig;
