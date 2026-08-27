import { defineConfig } from "oxfmt";

export default defineConfig({
  // Markdown prose (README, Japanese design specs) must stay as written, not get reflowed.
  ignorePatterns: ["worker-configuration.d.ts", "packages/db/drizzle/**", "**/*.md"],
  printWidth: 100,
  semi: true,
  singleQuote: false,
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
  trailingComma: "all",
  useTabs: false,
});
