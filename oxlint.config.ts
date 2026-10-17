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
      // Test runner は describe/it を自分で await するので、spec ごとに void を求めても雑音になる。
      files: ["**/*.spec.ts"],
      rules: {
        "typescript/no-floating-promises": "off",
      },
    },
  ],
  rules: {
    // 長いコメントは折り返すと、続きの行が文の途中から始まる。
    "capitalized-comments": ["error", "always", { ignoreConsecutiveComments: true }],
    // 層のファイルは処理を class の private method に収める規約なので、this を使わない method も置く。
    "class-methods-use-this": "off",
    "eslint/sort-imports": "off",
    "func-names": "off",
    "func-style": "off",
    "id-length": "off",
    "max-params": "off",
    "new-cap": "off",
    "no-console": "off",
    "no-duplicate-imports": "off",
    "no-empty-function": "off",
    // Discord の intents・application flags・permissions は bit field。
    "no-bitwise": "off",
    "no-magic-numbers": "off",
    "no-ternary": "off",
    "no-undefined": "off",
    "no-void": "off",
    "one-var": ["error", "never"],
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
    // Better-result の TaggedError(...) は class を返す factory で、名前が Error で終わるため誤検知になる。
    "unicorn/throw-new-error": "off",
  },
});
