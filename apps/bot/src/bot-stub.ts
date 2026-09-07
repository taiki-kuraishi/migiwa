import type { BotObject } from "./bot-object";

// One bot in v1, so one Durable Object. The hosted version keys this by bot user id (spec §2).
// Named "bot", not "default": the pre-rebuild skeleton created the "default" object, whose
// Drizzle journal names a migration that no longer exists, so its constructor throws
// `Rollback` forever. DO storage survives deploys and the class can't be deleted while bound
// (spec §6.6), so a fresh name is the only way to get a working object.
export const botStub = (env: Cloudflare.Env): DurableObjectStub<BotObject> =>
  env.BOT.get(env.BOT.idFromName("bot"));
