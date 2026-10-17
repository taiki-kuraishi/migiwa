import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    cache: { scripts: true, tasks: true },
    tasks: {
      fmt: "oxfmt",
      "fmt-check": "oxfmt --check",
      knip: {
        command: "knip",
        // Knip は設定を jiti で transpile し、設定が変わるたびに jiti の cache file を読み書きする。
        // その file を追跡すると、Vite Task が実行を cache しなくなる。
        cache: { input: [{ auto: true }, "!node_modules/.cache/**"] },
      },
      lint: "oxlint --deny-warnings",
      "type-check": "tsc --noEmit",
    },
  },
});
