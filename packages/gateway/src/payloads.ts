import type {
  GatewayHeartbeat,
  GatewayIdentify,
  GatewayResume,
} from "discord-api-types/gateway/v10";

// The gateway/v10 subpath is self-contained, unlike the top-level v10 barrel.
// That barrel's getter-based star exports resolve to undefined under vitest-pool-workers'
// Vite CJS interop (apps/bot's test runtime).
import { GatewayIntentBits, GatewayOpcodes } from "discord-api-types/gateway/v10";

// Fixed for v1 (spec D8). GUILD_PRESENCES is privileged.
// The bot's Presence Intent must be enabled in the Developer Portal, or Discord closes with 4014.
export const INTENTS =
  // oxlint-disable-next-line no-bitwise -- Discord intents are a bit field by definition.
  GatewayIntentBits.Guilds | GatewayIntentBits.GuildVoiceStates | GatewayIntentBits.GuildPresences;

export function identifyPayload(token: string): string {
  const payload: GatewayIdentify = {
    op: GatewayOpcodes.Identify,
    d: {
      token,
      intents: INTENTS,
      properties: { os: "cloudflare-workers", browser: "migiwa", device: "migiwa" },
    },
  };
  return JSON.stringify(payload);
}

export function resumePayload(token: string, sessionId: string, seq: number): string {
  const payload: GatewayResume = {
    op: GatewayOpcodes.Resume,
    d: { token, session_id: sessionId, seq },
  };
  return JSON.stringify(payload);
}

export function heartbeatPayload(seq: number | null): string {
  const payload: GatewayHeartbeat = { op: GatewayOpcodes.Heartbeat, d: seq };
  return JSON.stringify(payload);
}
