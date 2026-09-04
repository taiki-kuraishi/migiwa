import ttsc from "@ttsc/unplugin/esbuild";
import { build } from "esbuild";

// Wrangler's bundler exposes no plugin hook, so this pre-build step runs first (spec D13).
// It applies ttsc's transform for typia, then hands wrangler a single ESM file via `main`.
await build({
  entryPoints: ["src/entry.ts"],
  outfile: "dist/entry.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "esnext",
  conditions: ["workerd", "worker", "browser"],
  // Wrangler.jsonc enables nodejs_compat.
  // With platform: "browser", esbuild fails on the first node: import in the bundled graph.
  external: ["cloudflare:*", "node:*"],
  loader: { ".sql": "text" },
  sourcemap: true,
  plugins: [ttsc()],
});
