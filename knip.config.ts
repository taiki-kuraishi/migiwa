import type { KnipConfig } from "knip";

export default {
  bun: { config: ["package.json"] },
  entry: [],
  ignore: [],
  project: [],
  workspaces: {
    ".": {},
    "packages/gateway": {},
  },
} satisfies KnipConfig;
