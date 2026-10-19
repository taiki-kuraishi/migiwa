import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: [
    ".agents/**",
    "**/worker-configuration.d.ts",
    "packages/db/drizzle/**",
    // Markdown は手で整形する。oxfmt は表の各列を最も幅の広いセルに揃えるため、docs/specs の
    // 長い文章の表が、セルを 1 つ直すたびに表全体の diff になる。
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
