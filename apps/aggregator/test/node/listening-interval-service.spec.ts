import { describe, expect, test } from "vitest";

import { ListeningIntervalService } from "../../src/service/listening-interval-service";

const from = new Date("2026-10-19T00:00:00Z");
const to = new Date("2026-10-19T01:00:00Z");

const royal = {
  key: "5uBLK8BWV6PN3KZPUhuSzu",
  syncId: "5uBLK8BWV6PN3KZPUhuSzu",
  name: "Spotify",
  details: "MONTAGEM ROYAL",
  state: "NUEKI",
};
const next = { ...royal, key: "next", syncId: "next", details: "NEXT TRACK" };

function update(receivedAt: string, listenings: (typeof royal)[], seq = 0) {
  return {
    userId: "alice",
    receivedAt: new Date(receivedAt),
    sessionId: "session",
    seq,
    listenings,
  };
}

describe("ListeningIntervalService の connect", () => {
  test("曲が変わった時刻で前の曲の区間を閉じ、次の曲の区間を開く", () => {
    // Arrange
    const service = new ListeningIntervalService();

    // Act
    const intervals = service.connect({
      from,
      to,
      closedAtFrom: [],
      updates: [
        update("2026-10-19T00:10:00Z", [royal]),
        update("2026-10-19T00:13:00Z", [next], 1),
        update("2026-10-19T00:16:00Z", [], 2),
      ],
    });

    // Assert
    expect(intervals).toStrictEqual([
      {
        userId: "alice",
        listeningKey: royal.key,
        syncId: royal.syncId,
        name: "Spotify",
        details: "MONTAGEM ROYAL",
        state: "NUEKI",
        startedAt: new Date("2026-10-19T00:10:00Z"),
        endedAt: new Date("2026-10-19T00:13:00Z"),
      },
      {
        userId: "alice",
        listeningKey: "next",
        syncId: "next",
        name: "Spotify",
        details: "NEXT TRACK",
        state: "NUEKI",
        startedAt: new Date("2026-10-19T00:13:00Z"),
        endedAt: new Date("2026-10-19T00:16:00Z"),
      },
    ]);
  });

  test("from で閉じた区間は、同じ曲が続けば同じ開始時刻のまま to まで延ばす", () => {
    // Arrange
    const service = new ListeningIntervalService();
    const startedAt = new Date("2026-10-18T23:59:00Z");

    // Act
    const intervals = service.connect({
      from,
      to,
      closedAtFrom: [
        {
          userId: "alice",
          listeningKey: royal.key,
          syncId: royal.syncId,
          name: royal.name,
          details: royal.details,
          state: royal.state,
          startedAt,
          endedAt: from,
        },
      ],
      updates: [update("2026-10-19T00:01:00Z", [royal])],
    });

    // Assert
    expect(intervals).toStrictEqual([
      {
        userId: "alice",
        listeningKey: royal.key,
        syncId: royal.syncId,
        name: royal.name,
        details: royal.details,
        state: royal.state,
        startedAt,
        endedAt: to,
      },
    ]);
  });
});
