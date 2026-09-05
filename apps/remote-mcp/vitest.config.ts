import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { API_TOKEN: "test-token" },
        // The real BotObject lives in apps/bot.
        // Auxiliary workers must be pre-built JS and cannot read a wrangler config.
        // So tests bind `script_name: "migiwa-bot"` to a plain-JS fake with the same RPC surface.
        // The deploy + curl in each PR is what proves the real cross-script binding.
        workers: [
          {
            name: "migiwa-bot",
            modules: true,
            scriptPath: "./test/fake-bot/worker.js",
            compatibilityDate: "2026-08-01",
            compatibilityFlags: ["nodejs_compat"],
            durableObjects: { BOT: { className: "BotObject", useSQLite: true } },
          },
        ],
      },
    }),
  ],
  test: {
    testTimeout: 30_000,
  },
});
