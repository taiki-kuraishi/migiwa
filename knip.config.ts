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
  },
} satisfies KnipConfig;
