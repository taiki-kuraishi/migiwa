import type { KnipConfig } from "knip";

export default {
  bun: { config: ["package.json"] },
  entry: [],
  ignore: [],
  project: [],
  workspaces: {
    ".": { entry: ["scripts/*.ts"] },
    "packages/gateway": {},
  },
} satisfies KnipConfig;
