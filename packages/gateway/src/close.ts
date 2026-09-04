// The gateway/v10 subpath is self-contained, unlike the top-level v10 barrel.
// That barrel's getter-based star exports resolve to undefined under vitest-pool-workers'
// Vite CJS interop (apps/bot's test runtime).
import { GatewayCloseCodes } from "discord-api-types/gateway/v10";

export type CloseDecision =
  | { kind: "resume" }
  | { kind: "identify" }
  | { kind: "fatal"; reason: string };

// Codes after which Discord forbids RESUME but allows a fresh IDENTIFY (spec §5.7).
const IDENTIFY_CODES: ReadonlySet<number> = new Set([
    GatewayCloseCodes.NotAuthenticated,
    GatewayCloseCodes.InvalidSeq,
    GatewayCloseCodes.SessionTimedOut,
  ]),
  // Codes no reconnect can fix: a human has to change the token, intents or shard config.
  FATAL_CODES: ReadonlyMap<number, string> = new Map([
    [GatewayCloseCodes.AuthenticationFailed, "authentication_failed"],
    [GatewayCloseCodes.InvalidShard, "invalid_shard"],
    [GatewayCloseCodes.ShardingRequired, "sharding_required"],
    [GatewayCloseCodes.InvalidAPIVersion, "invalid_api_version"],
    [GatewayCloseCodes.InvalidIntents, "invalid_intents"],
    [GatewayCloseCodes.DisallowedIntents, "disallowed_intents"],
  ]);

// Everything else (network drops, 1006, 4000, a zombie we closed ourselves) is resumable.
export function decideOnClose(code: number | undefined): CloseDecision {
  if (code === undefined) {
    return { kind: "resume" };
  }
  const fatal = FATAL_CODES.get(code);
  if (fatal !== undefined) {
    return { kind: "fatal", reason: fatal };
  }
  if (IDENTIFY_CODES.has(code)) {
    return { kind: "identify" };
  }
  return { kind: "resume" };
}
