export type CloseDecision =
  | { kind: "resume" }
  | { kind: "identify" }
  | { kind: "fatal"; reason: string };

// https://docs.discord.com/developers/topics/opcodes-and-status-codes#gateway-gateway-close-event-codes
// Fatal codes are configuration errors; retrying them only burns the daily IDENTIFY budget.
const FATAL: Record<number, string> = {
  4004: "authentication_failed",
  4010: "invalid_shard",
  4011: "sharding_required",
  4012: "invalid_api_version",
  4013: "invalid_intents",
  4014: "disallowed_intents",
};

// The session is gone on these codes, so RESUME would only produce Invalid Session.
const NOT_RESUMABLE = new Set([4003, 4007, 4009]);

export function decideOnClose(code: number | undefined): CloseDecision {
  if (code !== undefined) {
    const reason = FATAL[code];
    if (reason !== undefined) {
      return { kind: "fatal", reason };
    }
    if (NOT_RESUMABLE.has(code)) {
      return { kind: "identify" };
    }
  }
  return { kind: "resume" };
}
