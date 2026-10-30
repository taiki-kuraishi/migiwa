import { describe, expect, test } from "vitest";

import { pendingRange } from "../../src/utils/pending-range";

describe("pendingRange", () => {
  test("処理済みの上限時刻から、now の delayMinutes 分前を時の頭に切り捨てた時刻までを返す", () => {
    // Act
    const range = pendingRange({
      processedUntil: new Date("2026-10-18T22:00:00Z"),
      now: new Date("2026-10-19T01:14:59Z"),
      delayMinutes: 15,
    });

    // Assert
    expect(range).toStrictEqual({
      from: new Date("2026-10-18T22:00:00Z"),
      to: new Date("2026-10-19T00:00:00Z"),
    });
  });

  test("溜まった時間は、1 回で 24 時間までを返す", () => {
    // Act
    const range = pendingRange({
      processedUntil: new Date("2026-10-15T00:00:00Z"),
      now: new Date("2026-10-19T01:30:00Z"),
      delayMinutes: 15,
    });

    // Assert
    expect(range).toStrictEqual({
      from: new Date("2026-10-15T00:00:00Z"),
      to: new Date("2026-10-16T00:00:00Z"),
    });
  });

  test("集計してよい時刻まで済んでいれば undefined を返す", () => {
    // Act
    const range = pendingRange({
      processedUntil: new Date("2026-10-19T00:00:00Z"),
      now: new Date("2026-10-19T01:14:59Z"),
      delayMinutes: 15,
    });

    // Assert
    expect(range).toBeUndefined();
  });

  test("初回は、集計してよい時刻の直前の 1 時間を返す", () => {
    // Act
    const range = pendingRange({
      processedUntil: undefined,
      now: new Date("2026-10-19T01:30:00Z"),
      delayMinutes: 15,
    });

    // Assert
    expect(range).toStrictEqual({
      from: new Date("2026-10-19T00:00:00Z"),
      to: new Date("2026-10-19T01:00:00Z"),
    });
  });
});
