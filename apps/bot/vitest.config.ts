import { cloudflareTest } from "@cloudflare/vitest-plugin";
import ttsc from "@ttsc/unplugin/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Plugin order matters here (spec D13): ttsc must run before cloudflareTest.
  // That ordering lets ttsc rewrite typia's `validate<T>()` calls before workerd bundles sources.
  plugins: [
    ttsc(),
    cloudflareTest({ main: "./src/entry.ts", wrangler: { configPath: "./wrangler.jsonc" } }),
  ],
  test: {
    // Workerd start-up on a 1 vCPU ubuntu-slim runner does not fit vitest's 5 s default.
    testTimeout: 30_000,
  },
});
