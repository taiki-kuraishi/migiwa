import { describe, expect, test } from "vitest";

import { PresenceIntervalService } from "../../src/service/presence-interval-service";

const from = new Date("2026-10-19T00:00:00Z");
const to = new Date("2026-10-19T01:00:00Z");

describe("PresenceIntervalService の connect", () => {
  test("from で閉じた区間は、変化が無ければ同じ開始時刻のまま to まで延ばす", () => {
    // Arrange
    const service = new PresenceIntervalService();

    // Act
    const intervals = service.connect({
      from,
      to,
      closedAtFrom: [
        {
          userId: "alice",
          status: "online",
          startedAt: new Date("2026-10-18T23:10:00Z"),
          endedAt: from,
        },
      ],
      updates: [],
    });

    // Assert
    expect(intervals).toStrictEqual([
      {
        userId: "alice",
        status: "online",
        startedAt: new Date("2026-10-18T23:10:00Z"),
        endedAt: to,
      },
    ]);
  });

  test("状態が変わった時刻で区間を切る", () => {
    // Arrange
    const service = new PresenceIntervalService();

    // Act
    const intervals = service.connect({
      from,
      to,
      closedAtFrom: [
        {
          userId: "alice",
          status: "online",
          startedAt: new Date("2026-10-18T23:10:00Z"),
          endedAt: from,
        },
      ],
      updates: [
        {
          userId: "alice",
          receivedAt: new Date("2026-10-19T00:20:00.500Z"),
          status: "idle",
          sessionId: "session",
          seq: null,
        },
      ],
    });

    // Assert
    expect(intervals).toStrictEqual([
      {
        userId: "alice",
        status: "online",
        startedAt: new Date("2026-10-18T23:10:00Z"),
        endedAt: new Date("2026-10-19T00:20:00.500Z"),
      },
      {
        userId: "alice",
        status: "idle",
        startedAt: new Date("2026-10-19T00:20:00.500Z"),
        endedAt: to,
      },
    ]);
  });

  test("offline を挟んだ online は、前の online を延ばさず新しい区間にする", () => {
    // Arrange
    const service = new PresenceIntervalService();

    // Act
    const intervals = service.connect({
      from,
      to,
      closedAtFrom: [
        {
          userId: "alice",
          status: "online",
          startedAt: new Date("2026-10-18T23:10:00Z"),
          endedAt: from,
        },
      ],
      updates: [
        {
          userId: "alice",
          receivedAt: new Date("2026-10-19T00:40:00Z"),
          status: "online",
          sessionId: "session",
          seq: null,
        },
        {
          userId: "alice",
          receivedAt: new Date("2026-10-19T00:10:00Z"),
          status: "offline",
          sessionId: "session",
          seq: null,
        },
      ],
    });

    // Assert
    expect(intervals).toStrictEqual([
      {
        userId: "alice",
        status: "online",
        startedAt: new Date("2026-10-18T23:10:00Z"),
        endedAt: new Date("2026-10-19T00:10:00Z"),
      },
      {
        userId: "alice",
        status: "offline",
        startedAt: new Date("2026-10-19T00:10:00Z"),
        endedAt: new Date("2026-10-19T00:40:00Z"),
      },
      {
        userId: "alice",
        status: "online",
        startedAt: new Date("2026-10-19T00:40:00Z"),
        endedAt: to,
      },
    ]);
  });

  test("同じ ms に逆順で届いた online → offline は、seq の順に当てて offline で終える", () => {
    // Arrange
    const service = new PresenceIntervalService();
    const at = new Date("2026-10-19T00:30:00Z");

    // Act
    const intervals = service.connect({
      from,
      to,
      closedAtFrom: [
        {
          userId: "alice",
          status: "idle",
          startedAt: new Date("2026-10-18T23:10:00Z"),
          endedAt: from,
        },
      ],
      updates: [
        { userId: "alice", receivedAt: at, status: "offline", sessionId: "session", seq: 6 },
        { userId: "alice", receivedAt: at, status: "online", sessionId: "session", seq: 5 },
      ],
    });

    // Assert
    expect(intervals).toStrictEqual([
      { userId: "alice", status: "idle", startedAt: new Date("2026-10-18T23:10:00Z"), endedAt: at },
      { userId: "alice", status: "offline", startedAt: at, endedAt: to },
    ]);
  });

  test("同じ ms に別 session の変化を挟んで逆順に届いても、同じ session の中は seq の順に当てる", () => {
    // Arrange
    const service = new PresenceIntervalService();
    const at = new Date("2026-10-19T00:30:00Z");

    // Act
    const intervals = service.connect({
      from,
      to,
      closedAtFrom: [],
      updates: [
        { userId: "alice", receivedAt: at, status: "offline", sessionId: "a", seq: 6 },
        { userId: "bob", receivedAt: at, status: "online", sessionId: "b", seq: 1 },
        { userId: "alice", receivedAt: at, status: "online", sessionId: "a", seq: 5 },
      ],
    });

    // Assert
    expect(intervals).toStrictEqual([
      { userId: "alice", status: "offline", startedAt: at, endedAt: to },
      { userId: "bob", status: "online", startedAt: at, endedAt: to },
    ]);
  });

  test("同じ状態が重ねて届いても区間を切らず、閉じた区間の無い user は最初の変化から始める", () => {
    // Arrange
    const service = new PresenceIntervalService();
    const update = {
      userId: "bob",
      receivedAt: new Date("2026-10-19T00:10:00Z"),
      status: "online" as const,
      sessionId: "session",
      seq: null,
    };

    // Act
    const intervals = service.connect({
      from,
      to,
      closedAtFrom: [],
      updates: [
        update,
        update,
        {
          userId: "bob",
          receivedAt: new Date("2026-10-19T00:30:00Z"),
          status: "online",
          sessionId: "session",
          seq: null,
        },
        {
          userId: "bob",
          receivedAt: new Date("2026-10-19T00:50:00Z"),
          status: "idle",
          sessionId: "session",
          seq: null,
        },
      ],
    });

    // Assert
    expect(intervals).toStrictEqual([
      {
        userId: "bob",
        status: "online",
        startedAt: new Date("2026-10-19T00:10:00Z"),
        endedAt: new Date("2026-10-19T00:50:00Z"),
      },
      {
        userId: "bob",
        status: "idle",
        startedAt: new Date("2026-10-19T00:50:00Z"),
        endedAt: to,
      },
    ]);
  });
});
