import { cloudflareTest } from "@cloudflare/vitest-plugin";
import ttsc from "@ttsc/unplugin/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Plugin order matters here (spec D13): ttsc must run before cloudflareTest.
  // That ordering lets ttsc rewrite typia's `validate<T>()` calls before workerd bundles sources.
  plugins: [
    ttsc(),
    cloudflareTest({
      main: "./src/entry.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { DISCORD_BOT_TOKEN: "test-token" },
        // Every outbound fetch() of the Worker under test (GET /gateway/bot, the WebSocket
        // Upgrade) lands on the mock Discord below, so BotObject runs its production code path.
        outboundService: "mock-discord",
        // Tests steer the mock through this binding.
        serviceBindings: { MOCK: "mock-discord" },
        workers: [
          {
            name: "mock-discord",
            modules: true,
            scriptPath: "./test/mock-discord/worker.js",
            compatibilityDate: "2026-08-01",
            // No useSQLite: the mock keeps its state (server socket, received frames, options)
            // In instance fields, not storage (see the file header in worker.js).
            durableObjects: { GATEWAY: { className: "MockGateway" } },
          },
        ],
      },
    }),
  ],
  test: {
    // Workerd start-up on a 1 vCPU ubuntu-slim runner does not fit vitest's 5 s default.
    testTimeout: 30_000,
    // This suite relies on vitest's default per-file isolation: `--no-isolate` breaks it because
    // Every file's BotObject and mock-discord/worker.js's single "gateway" MockGateway instance
    // Must not leak into another file's tests — each needs its own fresh DO and fresh bot.
    // BotObject.query() throwing across the DO RPC boundary (spec D12) is exactly the case
    // Cloudflare/workers-sdk#7707 (open) logs as a spurious "unhandled error": the throw is
    // Properly awaited and asserted by `.rejects.toThrow()`, but vitest-pool-workers' own RPC
    // Bookkeeping leaves an internal promise unhandled and vitest fails the run for it. Remove
    // This once that issue is fixed upstream.
    dangerouslyIgnoreUnhandledErrors: true,
  },
});
