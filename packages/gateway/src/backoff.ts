// 1 s × 2^attempt capped at five minutes, then ±25 % jitter (spec §5.7).
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(1000 * 2 ** attempt, 300_000);
  return Math.round(base * (0.75 + random() * 0.5));
}

// Discord asks for a 1-5 s wait after Invalid Session before the next IDENTIFY / RESUME.
export function invalidSessionDelayMs(random: () => number = Math.random): number {
  return Math.round(1000 + random() * 4000);
}

// After a fatal close code, the next attempt waits an hour (spec §5.7).
// A misconfigured bot must not burn the daily IDENTIFY budget of 1,000.
// IDENTIFYs are also kept in reserve out of that budget (spec §5.3).
export const FATAL_RETRY_MS = 3_600_000,
  IDENTIFY_RESERVE = 50;
