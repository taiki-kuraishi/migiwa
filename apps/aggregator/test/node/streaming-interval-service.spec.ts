import { describe, expect, test } from "vitest";

import { StreamingIntervalService } from "../../src/service/streaming-interval-service";

const from = new Date("2026-10-19T00:00:00Z");
const to = new Date("2026-10-19T01:00:00Z");

const twitch = {
  key: "https://www.twitch.tv/alice",
  url: "https://www.twitch.tv/alice",
  name: "Twitch",
  details: "ランク回す",
};

function update(receivedAt: string, streamings: (typeof twitch)[], seq: number) {
  return {
    userId: "alice",
    receivedAt: new Date(receivedAt),
    sessionId: "session",
    seq,
    streamings,
  };
}

describe("StreamingIntervalService の connect", () => {
  test("配信中にタイトルが変わっても区間を切らず、開いたときのタイトルのまま消えた時刻で閉じる", () => {
    // Arrange
    const service = new StreamingIntervalService();

    // Act
    const intervals = service.connect({
      from,
      to,
      closedAtFrom: [],
      updates: [
        update("2026-10-19T00:10:00Z", [twitch], 0),
        update("2026-10-19T00:30:00Z", [{ ...twitch, details: "雑談" }], 1),
        update("2026-10-19T00:40:00Z", [], 2),
      ],
    });

    // Assert
    expect(intervals).toStrictEqual([
      {
        userId: "alice",
        streamingKey: twitch.key,
        url: twitch.url,
        name: "Twitch",
        details: "ランク回す",
        startedAt: new Date("2026-10-19T00:10:00Z"),
        endedAt: new Date("2026-10-19T00:40:00Z"),
      },
    ]);
  });

  test("from で閉じた区間は、同じ配信が続けば同じ開始時刻のまま to まで延ばす", () => {
    // Arrange
    const service = new StreamingIntervalService();
    const startedAt = new Date("2026-10-18T23:30:00Z");
    const interval = {
      userId: "alice",
      streamingKey: twitch.key,
      url: twitch.url,
      name: twitch.name,
      details: twitch.details,
      startedAt,
    };

    // Act
    const intervals = service.connect({
      from,
      to,
      closedAtFrom: [{ ...interval, endedAt: from }],
      updates: [update("2026-10-19T00:01:00Z", [twitch], 0)],
    });

    // Assert
    expect(intervals).toStrictEqual([{ ...interval, endedAt: to }]);
  });
});
