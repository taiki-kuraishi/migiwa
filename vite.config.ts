import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    cache: { scripts: true, tasks: true },
    tasks: {
      fmt: "oxfmt",
      "fmt-check": "oxfmt --check",
      knip: {
        command: "knip",
        // Knip transpiles its config through jiti, which reads and rewrites its cache file on
        // every config change; tracking that file makes Vite Task refuse to cache the run.
        cache: { input: [{ auto: true }, "!node_modules/.cache/**"] },
      },
      lint: "oxlint --deny-warnings",
      "type-check": "tsc --noEmit",
    },
  },
});
