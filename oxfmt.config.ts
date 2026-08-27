import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: ["worker-configuration.d.ts", "packages/db/drizzle/**"],
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
