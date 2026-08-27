import { defineConfig } from "oxlint";

export default defineConfig({
  categories: {
    correctness: "error",
    perf: "error",
    restriction: "error",
    style: "error",
    suspicious: "error",
  },
  ignorePatterns: ["**/worker-configuration.d.ts", "packages/db/drizzle/**"],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  overrides: [
    {
      // Test runners await describe/it themselves; requiring void on every spec is noise.
      files: ["**/*.spec.ts"],
      rules: {
        "typescript/no-floating-promises": "off",
      },
    },
  ],
  rules: {
    "eslint/no-unused-vars": "error",
    "eslint/sort-imports": "off",
    "func-names": "off",
    "func-style": "off",
    "id-length": "off",
    "max-params": "off",
    "no-bitwise": "off",
    "no-console": "off",
    "no-duplicate-imports": "off",
    "no-empty-function": "off",
    "no-magic-numbers": "off",
    "no-ternary": "off",
    "no-undefined": "off",
    "no-void": "off",
    "one-var": ["error", "never"],
    "oxc/bad-bitwise-operator": "off",
    "oxc/no-async-await": "off",
    "oxc/no-optional-chaining": "off",
    "oxc/no-rest-spread-properties": "off",
    "typescript/explicit-function-return-type": "off",
    "typescript/explicit-module-boundary-types": "off",
    "unicorn/consistent-function-scoping": "off",
    "unicorn/filename-case": ["error", { case: "kebabCase" }],
    "unicorn/no-anonymous-default-export": "off",
    "unicorn/no-null": "off",
    "sort-keys": "off",
    "new-cap": "off",
  },
});
