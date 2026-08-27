import { defineConfig } from "vite-plus";

// Workspace task runner config for `vp run`.
// `vp run -r <task>` runs a script in every workspace that defines it, in dependency order.
// `cf-typegen` has no workspace owner yet (zero apps in PR 1).
// Declaring it here as a no-op keeps `vp run -r cf-typegen` from erroring with
// "Task not found" until an app adds a real `cf-typegen` script.
export default defineConfig({
  run: {
    // Cache package.json script runs through vp run, keyed on input files; knip is excluded because it mutates its own inputs and never caches.
    cache: { scripts: true },
    tasks: {
      "cf-typegen": "true",
    },
  },
});
