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
    // BotObject.query() throwing across the DO RPC boundary (spec D12) is exactly the case
    // Cloudflare/workers-sdk#7707 (open) logs as a spurious "unhandled error": the throw is
    // Properly awaited and asserted by `.rejects.toThrow()`, but vitest-pool-workers' own RPC
    // Bookkeeping leaves an internal promise unhandled and vitest fails the run for it. Remove
    // This once that issue is fixed upstream.
    dangerouslyIgnoreUnhandledErrors: true,
  },
});
