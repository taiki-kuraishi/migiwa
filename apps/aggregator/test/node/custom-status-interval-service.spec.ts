import { describe, expect, test } from "vitest";

import { CustomStatusIntervalService } from "../../src/service/custom-status-interval-service";

const from = new Date("2026-10-19T00:00:00Z");
const to = new Date("2026-10-19T01:00:00Z");

function update(receivedAt: string, states: string[], seq: number) {
  return {
    userId: "alice",
    receivedAt: new Date(receivedAt),
    sessionId: "session",
    seq,
    customStatuses: states.map((state) => ({ state })),
  };
}

describe("CustomStatusIntervalService の connect", () => {
  test("文言が変わった時刻で区間を切り、消えた時刻で閉じる", () => {
    // Arrange
    const service = new CustomStatusIntervalService();

    // Act
    const intervals = service.connect({
      from,
      to,
      closedAtFrom: [],
      updates: [
        update("2026-10-19T00:10:00Z", ["作業中"], 0),
        update("2026-10-19T00:20:00Z", ["作業中"], 1),
        update("2026-10-19T00:30:00Z", ["休憩"], 2),
        update("2026-10-19T00:40:00Z", [], 3),
      ],
    });

    // Assert
    expect(intervals).toStrictEqual([
      {
        userId: "alice",
        state: "作業中",
        startedAt: new Date("2026-10-19T00:10:00Z"),
        endedAt: new Date("2026-10-19T00:30:00Z"),
      },
      {
        userId: "alice",
        state: "休憩",
        startedAt: new Date("2026-10-19T00:30:00Z"),
        endedAt: new Date("2026-10-19T00:40:00Z"),
      },
    ]);
  });

  test("from で閉じた区間は、同じ文言が続けば同じ開始時刻のまま to まで延ばす", () => {
    // Arrange
    const service = new CustomStatusIntervalService();
    const interval = {
      userId: "alice",
      state: "作業中",
      startedAt: new Date("2026-10-18T23:00:00Z"),
    };

    // Act
    const intervals = service.connect({
      from,
      to,
      closedAtFrom: [{ ...interval, endedAt: from }],
      updates: [update("2026-10-19T00:05:00Z", ["作業中"], 0)],
    });

    // Assert
    expect(intervals).toStrictEqual([{ ...interval, endedAt: to }]);
  });
});
