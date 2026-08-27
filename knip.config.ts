import type { KnipConfig } from "knip";

export default {
  bun: { config: ["package.json"] },
  entry: [],
  ignore: [],
  project: [],
  // Catalog entries for PR 2+ workspaces don't exist yet, so this check is a false positive;
  // Revisit once those packages consume catalog entries so orphaned ones can be caught again.
  rules: { catalog: "off" },
  workspaces: {
    ".": {},
    "packages/gateway": {},
  },
} satisfies KnipConfig;
