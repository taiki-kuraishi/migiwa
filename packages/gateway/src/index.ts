export * from "./backoff";
export * from "./close";
export * from "./envelope";
export * from "./heartbeat";
export * from "./payloads";
export * from "./rpc";
export type * from "./slices";
export * from "./url";
export * from "./validate";

// Re-exported so apps/bot never needs to import discord-api-types directly for these values.
// The top-level v10 barrel resolves value imports to `undefined` under that vitest-plugin runtime.
// See .claude/rules/rebuild.md for the mechanism.
export {
  GatewayDispatchEvents,
  GatewayIntentBits,
  GatewayOpcodes,
} from "discord-api-types/gateway/v10";
