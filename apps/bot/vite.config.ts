import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      test: {
        // @cloudflare/vitest-plugin は vitest 4 の plugin なので、vite-plus が同梱する vitest（vp test）
        // ではなく、catalog の vitest で走らせる。
        command: "vitest run",
        // Vitest は実行のたびに node_modules/.vite の下の結果 cache を書き換える。その file を
        // 追跡すると、Vite Task が実行を cache しなくなる。
        cache: { input: [{ auto: true }, "!**/node_modules/.vite/**"] },
      },
    },
  },
});
