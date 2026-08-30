import { defineConfig } from "vite-plus";

// Workspace task runner config for `vp run`.
// `vp run -r <task>` runs a script in every workspace that defines it, in dependency order.
export default defineConfig({
  run: {
    // Cache package.json script runs through vp run, keyed on input files; knip is excluded because it mutates its own inputs and never caches.
    cache: { scripts: true },
  },
});
