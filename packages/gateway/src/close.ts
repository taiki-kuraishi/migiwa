// The gateway/v10 subpath is self-contained, unlike the top-level v10 barrel.
// That barrel's getter-based star exports resolve to undefined under vitest-pool-workers'
// Vite CJS interop (apps/bot's test runtime).
import { GatewayCloseCodes } from "discord-api-types/gateway/v10";

export type CloseDecision =
  | { kind: "resume" }
  | { kind: "identify" }
  | { kind: "fatal"; reason: string };

// Closing with 1000 or 1001 tells Discord the client is done, so it drops the session.
// The following RESUME then fails with op 9 (`d: false`).
// 4000 falls outside that range, so Discord treats the close as abnormal.
// That keeps the session alive, so the following RESUME can succeed (spec §5.5).
// Every close meant to resume must use this code, not 1000/1001.
const RECONNECT_CLOSE_CODE = 4000,
  // Codes after which Discord forbids RESUME but allows a fresh IDENTIFY (spec §5.7).
  IDENTIFY_CODES: ReadonlySet<number> = new Set([
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

export { RECONNECT_CLOSE_CODE };

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
    // Spec §5.7 wants a 1-5 s wait here before the next IDENTIFY.
    // Pair this decision with invalidSessionDelayMs, not backoffDelayMs.
    return { kind: "identify" };
  }
  return { kind: "resume" };
}
