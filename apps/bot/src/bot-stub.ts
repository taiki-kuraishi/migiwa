import type { BotObject } from "./bot-object";

// One bot in v1, so one Durable Object. The hosted version keys this by bot user id (spec §2).
export const botStub = (env: Cloudflare.Env): DurableObjectStub<BotObject> =>
  // Wrangler types leaves a same-script DO binding as a bare, unparameterized
  // DurableObjectNamespace; BotObject's RPC surface is now large enough that the implicit
  // Structural check against it exceeds ttsc's instantiation depth limit (TS2589) without this
  // Cast, even though the class is defined in this script. oxlint's own type-aware pass
  // Resolves the depth fine and calls the cast unnecessary; ttsc (AGENTS.md's source of truth
  // For types) does not, so both rules below are suppressed for this one line.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see comment above.
  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- see comment above.
  env.BOT.get(env.BOT.idFromName("default")) as DurableObjectStub<BotObject>;
