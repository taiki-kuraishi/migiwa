import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // Deploy と同じ wrangler.jsonc で、scheduled handler を Workers の runtime で走らせる。
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
        test: { name: "worker", include: ["test/worker/**/*.spec.ts"] },
      },
      {
        // 集計は in-process の libSQL（test/node/db.ts）を使う。native の module なので Workers の runtime
        // では読めず、Node で走らせる。
        test: { name: "node", include: ["test/node/**/*.spec.ts"], environment: "node" },
      },
    ],
  },
});
