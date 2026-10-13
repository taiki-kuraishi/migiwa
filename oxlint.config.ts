import { defineConfig } from "oxlint";

export default defineConfig({
  categories: {
    correctness: "error",
    perf: "error",
    restriction: "error",
    style: "error",
    suspicious: "error",
  },
  ignorePatterns: [".agents/**", "**/worker-configuration.d.ts"],
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
    // Long comments wrap onto continuation lines that start mid-sentence.
    "capitalized-comments": ["error", "always", { ignoreConsecutiveComments: true }],
    "eslint/sort-imports": "off",
    "func-names": "off",
    "func-style": "off",
    "id-length": "off",
    "max-params": "off",
    "new-cap": "off",
    "no-console": "off",
    "no-duplicate-imports": "off",
    "no-empty-function": "off",
    "no-magic-numbers": "off",
    "no-ternary": "off",
    "no-undefined": "off",
    "no-void": "off",
    "oxc/no-async-await": "off",
    "oxc/no-optional-chaining": "off",
    "oxc/no-rest-spread-properties": "off",
    "sort-keys": "off",
    "typescript/explicit-function-return-type": "off",
    "typescript/explicit-module-boundary-types": "off",
    "unicorn/consistent-function-scoping": "off",
    "unicorn/filename-case": ["error", { case: "kebabCase" }],
    "unicorn/no-anonymous-default-export": "off",
    "unicorn/no-null": "off",
  },
});
