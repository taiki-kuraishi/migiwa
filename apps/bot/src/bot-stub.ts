import type { BotObject } from "./bot-object";

// One bot in v1, so one Durable Object. The hosted version keys this by bot user id (spec §2).
export const botStub = (env: Cloudflare.Env): DurableObjectStub<BotObject> =>
  env.BOT.get(env.BOT.idFromName("default"));
