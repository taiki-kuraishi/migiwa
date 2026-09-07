import { defineConfig } from "vite-plus";

// `bun test`'s file reads never register with vite-plus's automatic input tracking
// (verified: editing a file the tests import does not invalidate the cache either), so
// `cache: true` here would replay whatever test results happened to be cached forever.
// A `vite.config.ts` task can't share its name with a package.json script, so package.json's
// "test" script is a thin `vp run bun-test` wrapper and this task carries the real `cache: false`.
export default defineConfig({
  run: {
    tasks: {
      "bun-test": {
        command: "bun test",
        cache: false,
      },
    },
  },
});
