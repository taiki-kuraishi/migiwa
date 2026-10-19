import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      test: {
        command: "vp test",
        // Vitest は実行のたびに node_modules/.vite の下の結果 cache を書き換える。その file を
        // 追跡すると、Vite Task が実行を cache しなくなる。
        cache: { input: [{ auto: true }, "!**/node_modules/.vite/**"] },
      },
    },
  },
});
