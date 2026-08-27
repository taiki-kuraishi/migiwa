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
const T0 = 1_000_000;

describe("heartbeat state", () => {
  test("first heartbeat is due after interval * random, as an integer", () => {
    const state = heartbeatOnHello(INTERVAL, T0, () => 0.5);
    expect(state).toEqual({
      intervalMs: INTERVAL,
      lastSentAt: null,
      lastAckAt: null,
      nextDueAt: T0 + 20_625,
    });
    expect(Number.isInteger(heartbeatOnHello(INTERVAL, T0, () => 0.333333).nextDueAt)).toBe(true);
  });

  test("sending schedules the next heartbeat one interval later", () => {
    const state = heartbeatOnSend(
      heartbeatOnHello(INTERVAL, T0, () => 0),
      T0 + 10,
    );
    expect(state.lastSentAt).toBe(T0 + 10);
    expect(state.nextDueAt).toBe(T0 + 10 + INTERVAL);
  });

  test("isHeartbeatDue compares against nextDueAt", () => {
    const state = heartbeatOnHello(INTERVAL, T0, () => 0.5);
    expect(isHeartbeatDue(state, T0 + 20_624)).toBe(false);
    expect(isHeartbeatDue(state, T0 + 20_625)).toBe(true);
  });

  test("isZombie is true only when a sent heartbeat was never acked and the next one is due", () => {
    const hello = heartbeatOnHello(INTERVAL, T0, () => 0);
    expect(isZombie(hello, T0 + INTERVAL)).toBe(false);

    const sent = heartbeatOnSend(hello, T0);
    expect(isZombie(sent, T0 + INTERVAL - 1)).toBe(false);
    expect(isZombie(sent, T0 + INTERVAL)).toBe(true);

    const acked = heartbeatOnAck(sent, T0 + 100);
    expect(isZombie(acked, T0 + INTERVAL)).toBe(false);

    const sentAgain = heartbeatOnSend(acked, T0 + INTERVAL);
    expect(isZombie(sentAgain, T0 + 2 * INTERVAL)).toBe(true);
  });

  test("isHealthy requires an ack within the last two intervals", () => {
    const hello = heartbeatOnHello(INTERVAL, T0, () => 0);
    expect(isHealthy(hello, T0)).toBe(false);
    const acked = heartbeatOnAck(heartbeatOnSend(hello, T0), T0 + 50);
    expect(isHealthy(acked, T0 + 50 + 2 * INTERVAL - 1)).toBe(true);
    expect(isHealthy(acked, T0 + 50 + 2 * INTERVAL)).toBe(false);
  });
});
