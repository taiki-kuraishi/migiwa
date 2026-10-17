import type { KnipConfig } from "knip";

export default {
  // 今は vendor した skill に JS/TS が無いので knip は "Remove from ignore" と hint を出す。将来の
  // skill の版が script を持ち込んでも未使用ファイルとして報告させないため、この entry は残す。
  ignore: [".agents/**"],
  rules: {
    // Workspace が使い始める前から、catalog で Worker と package の版を固定している。
    catalog: "off",
  },
} satisfies KnipConfig;
