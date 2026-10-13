import type { KnipConfig } from "knip";

export default {
  // Vendored skills hold no JS/TS today, so knip hints "Remove from ignore"; the entry stays so
  // scripts a future skill version ships are never reported as unused files.
  ignore: [".agents/**"],
  rules: {
    // The catalog pins versions for the Workers and packages before any workspace consumes them.
    catalog: "off",
  },
} satisfies KnipConfig;
