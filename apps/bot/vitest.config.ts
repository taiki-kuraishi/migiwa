import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    deps: { optimizer: { ssr: { enabled: true, include: ["discord-api-types/v10"] } } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["./test/setup.ts"],
  },
});
