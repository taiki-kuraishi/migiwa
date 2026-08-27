const BASE_MS = 1000;
const CAP_MS = 300_000;
const JITTER_MS = 1000;

// Results are floored because they end up in setAlarm(), which needs integers.
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(BASE_MS * 2 ** Math.max(0, attempt), CAP_MS);
  return Math.floor(exponential + random() * JITTER_MS);
}

// Discord asks clients to wait a random 1-5 s before reconnecting after Invalid Session:
// https://docs.discord.com/developers/events/gateway#resuming
export function invalidSessionDelayMs(random: () => number = Math.random): number {
  return Math.floor(1000 + random() * 4000);
}
