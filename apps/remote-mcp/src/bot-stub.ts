import type { BotRpc } from "@migiwa/gateway";

// `wrangler types` cannot see BotObject's class across scripts, so env.BOT's stub is untyped;
// BotRpc (packages/gateway) is the contract both Workers agree on. One bot in v1, one object.
export const botStub = (env: Cloudflare.Env): BotRpc =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- untyped cross-script stub.
  env.BOT.get(env.BOT.idFromName("default")) as unknown as BotRpc;
