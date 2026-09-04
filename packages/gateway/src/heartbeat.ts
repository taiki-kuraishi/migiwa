export interface HeartbeatState {
  readonly intervalMs: number;
  readonly lastSentAt: number | null;
  readonly lastAckAt: number | null;
  readonly nextDueAt: number;
}

// Discord's rule: the first heartbeat goes out after interval × random(), then every interval.
export function heartbeatOnHello(
  intervalMs: number,
  now: number,
  random: () => number = Math.random,
): HeartbeatState {
  return {
    intervalMs,
    lastSentAt: null,
    lastAckAt: null,
    nextDueAt: now + Math.floor(intervalMs * random()),
  };
}

export function heartbeatOnSend(state: HeartbeatState, now: number): HeartbeatState {
  return { ...state, lastSentAt: now, nextDueAt: now + state.intervalMs };
}

export function heartbeatOnAck(state: HeartbeatState, now: number): HeartbeatState {
  return { ...state, lastAckAt: now };
}

export function isHeartbeatDue(state: HeartbeatState, now: number): boolean {
  return now >= state.nextDueAt;
}

// A heartbeat went out and its ACK never came back before the next one is due.
// Discord calls this a zombied connection and wants a non-1000 close followed by RESUME
// (spec §5.5).
export function isZombie(state: HeartbeatState, now: number): boolean {
  return (
    state.lastSentAt !== null &&
    (state.lastAckAt === null || state.lastAckAt < state.lastSentAt) &&
    isHeartbeatDue(state, now)
  );
}

// The connect loop treats a socket as healthy while heartbeats keep up.
// No heartbeat is overdue by more than an interval (a dead alarm chain would show up here).
// The last heartbeat sent has also been acknowledged.
export function isHealthy(state: HeartbeatState, now: number): boolean {
  return !isZombie(state, now) && now < state.nextDueAt + state.intervalMs;
}
