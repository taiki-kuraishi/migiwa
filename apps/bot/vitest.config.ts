import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    // Workerd start-up on a 1 vCPU ubuntu-slim runner does not fit vitest's 5 s default.
    testTimeout: 30_000,
  },
});
