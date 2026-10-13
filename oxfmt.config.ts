import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: [
    ".agents/**",
    "**/worker-configuration.d.ts",
    // Markdown stays hand-formatted: oxfmt pads every table column to its widest cell, which
    // turns the long prose tables in docs/specs into whole-table diffs on any one-cell edit.
    "**/*.md",
  ],
  sortImports: {
    groups: [
      "type-import",
      ["value-builtin", "value-external"],
      "type-internal",
      "value-internal",
      ["type-parent", "type-sibling", "type-index"],
      ["value-parent", "value-sibling", "value-index"],
      "unknown",
    ],
  },
});
