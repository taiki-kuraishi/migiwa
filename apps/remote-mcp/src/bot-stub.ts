import type { BotRpc } from "@migiwa/gateway";

// `wrangler types` cannot see BotObject's class across scripts, so env.BOT's stub is untyped;
// BotRpc (packages/gateway) is the contract both Workers agree on. One bot in v1, one object.
// Named "bot", not "default": the pre-rebuild skeleton created the "default" object, whose
// Drizzle journal names a migration that no longer exists, so its constructor throws
// `Rollback` forever. DO storage survives deploys and the class can't be deleted while bound
// (spec §6.6), so a fresh name is the only way to get a working object.
export const botStub = (env: Cloudflare.Env): BotRpc =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- untyped cross-script stub.
  env.BOT.get(env.BOT.idFromName("bot")) as unknown as BotRpc;
