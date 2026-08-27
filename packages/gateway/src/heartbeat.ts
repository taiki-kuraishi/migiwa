export interface HeartbeatState {
  intervalMs: number;
  lastSentAt: number | null;
  lastAckAt: number | null;
  nextDueAt: number;
}

// Discord asks for the first heartbeat after interval * jitter.
// Clients that reconnect at the same moment would otherwise heartbeat in lockstep.
export function heartbeatOnHello(
  intervalMs: number,
  now: number,
  random: () => number = Math.random,
): HeartbeatState {
  return {
    intervalMs,
    lastSentAt: null,
    lastAckAt: null,
    nextDueAt: Math.floor(now + intervalMs * random()),
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

// A heartbeat that was sent and never acked before the next one is due means a dead connection.
// The socket can still look open in that state.
export function isZombie(state: HeartbeatState, now: number): boolean {
  if (!isHeartbeatDue(state, now) || state.lastSentAt === null) {
    return false;
  }
  return state.lastAckAt === null || state.lastAckAt < state.lastSentAt;
}

// A socket whose last ack is recent is alive, so ensureConnected() leaves it alone.
export function isHealthy(state: HeartbeatState, now: number): boolean {
  return state.lastAckAt !== null && now - state.lastAckAt < 2 * state.intervalMs;
}
