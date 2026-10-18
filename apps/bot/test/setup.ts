import { env } from "cloudflare:workers";
import { beforeEach, vi } from "vitest";

import { network } from "./network";

network.enable();

// テストの Secrets Store は空で、get() は "not found" で reject する。
beforeEach(() => {
  vi.spyOn(env.DISCORD_BOT_TOKEN, "get").mockResolvedValue("test-token");
});
