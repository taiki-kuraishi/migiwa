import { describe, expect, test } from "bun:test";

import {
  heartbeatOnAck,
  heartbeatOnHello,
  heartbeatOnSend,
  isHealthy,
  isHeartbeatDue,
  isZombie,
} from "../src/heartbeat";

const INTERVAL = 41_250;

describe("heartbeat state machine", () => {
  test("the first heartbeat is due after interval × random()", () => {
    const state = heartbeatOnHello(INTERVAL, 1000, () => 0.5);
    expect(state.nextDueAt).toBe(1000 + INTERVAL / 2);
    expect(state.lastSentAt).toBeNull();
    expect(state.lastAckAt).toBeNull();

    // A near-1 random pins Math.floor's truncation: 41_250 × 0.9999999 = 41249.995875.
    // Only Math.floor turns that into 41249 (Math.round or Math.ceil would give 41250 instead).
    expect(heartbeatOnHello(INTERVAL, 1000, () => 0.9999999).nextDueAt).toBe(42_249);
  });

  test("sending schedules the next one a full interval later", () => {
    const state = heartbeatOnSend(
      heartbeatOnHello(INTERVAL, 1000, () => 0),
      2000,
    );
    expect(state.lastSentAt).toBe(2000);
    expect(state.nextDueAt).toBe(2000 + INTERVAL);
    expect(isHeartbeatDue(state, 2000 + INTERVAL - 1)).toBe(false);
    expect(isHeartbeatDue(state, 2000 + INTERVAL)).toBe(true);
  });

  test("a heartbeat without an ACK is a zombie once the next one is due", () => {
    const sent = heartbeatOnSend(
        heartbeatOnHello(INTERVAL, 0, () => 0),
        0,
      ),
      acked = heartbeatOnAck(sent, 100);
    expect(isZombie(sent, INTERVAL - 1)).toBe(false);
    expect(isZombie(sent, INTERVAL)).toBe(true);
    expect(isZombie(acked, INTERVAL)).toBe(false);
  });

  test("healthy means no heartbeat is overdue by more than an interval and none is unacked", () => {
    const fresh = heartbeatOnHello(INTERVAL, 0, () => 0),
      acked = heartbeatOnAck(heartbeatOnSend(fresh, 0), 100),
      unacked = heartbeatOnSend(fresh, 0);
    expect(isHealthy(fresh, 0)).toBe(true);
    expect(isHealthy(fresh, INTERVAL)).toBe(false);
    expect(isHealthy(acked, 2 * INTERVAL - 1)).toBe(true);
    expect(isHealthy(acked, 2 * INTERVAL)).toBe(false);
    expect(isHealthy(unacked, INTERVAL)).toBe(false);
  });
});
