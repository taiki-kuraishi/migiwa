import { describe, expect, test } from "vitest";

import { GameIntervalService } from "../../src/service/game-interval-service";

const from = new Date("2026-10-19T00:00:00Z");
const to = new Date("2026-10-19T01:00:00Z");

const valorant = {
  key: "700136079562375258",
  applicationId: "700136079562375258",
  officialGameId: "1443350165678198935",
  name: "VALORANT",
};
const wallpaper = {
  key: "Wallpaper Engine",
  applicationId: null,
  officialGameId: null,
  name: "Wallpaper Engine",
};

function update(receivedAt: string, games: (typeof valorant | typeof wallpaper)[], seq = 0) {
  return { userId: "alice", receivedAt: new Date(receivedAt), sessionId: "session", seq, games };
}

describe("GameIntervalService の connect", () => {
  test("from で閉じた区間は、同じゲームが続けば同じ開始時刻のまま、消えた時刻で閉じる", () => {
    // Arrange
    const service = new GameIntervalService();
    const startedAt = new Date("2026-10-18T23:10:00Z");

    // Act
    const intervals = service.connect({
      from,
      to,
      closedAtFrom: [
        {
          userId: "alice",
          gameKey: valorant.key,
          applicationId: valorant.applicationId,
          officialGameId: valorant.officialGameId,
          name: valorant.name,
          startedAt,
          endedAt: from,
        },
      ],
      updates: [update("2026-10-19T00:10:00Z", [valorant]), update("2026-10-19T00:20:00Z", [], 1)],
    });

    // Assert
    expect(intervals).toStrictEqual([
      {
        userId: "alice",
        gameKey: valorant.key,
        applicationId: valorant.applicationId,
        officialGameId: valorant.officialGameId,
        name: valorant.name,
        startedAt,
        endedAt: new Date("2026-10-19T00:20:00Z"),
      },
    ]);
  });

  test("同時に遊んでいるゲームはそれぞれ区間にし、名前が変わっても開いたときの名前で続ける", () => {
    // Arrange
    const service = new GameIntervalService();

    // Act
    const intervals = service.connect({
      from,
      to,
      closedAtFrom: [],
      updates: [
        update("2026-10-19T00:10:00Z", [valorant]),
        update("2026-10-19T00:20:00Z", [{ ...valorant, name: "ヴァロラント" }, wallpaper], 1),
        update("2026-10-19T00:30:00Z", [wallpaper], 2),
      ],
    });

    // Assert
    expect(intervals).toStrictEqual([
      {
        userId: "alice",
        gameKey: valorant.key,
        applicationId: valorant.applicationId,
        officialGameId: valorant.officialGameId,
        name: "VALORANT",
        startedAt: new Date("2026-10-19T00:10:00Z"),
        endedAt: new Date("2026-10-19T00:30:00Z"),
      },
      {
        userId: "alice",
        gameKey: wallpaper.key,
        applicationId: null,
        officialGameId: null,
        name: wallpaper.name,
        startedAt: new Date("2026-10-19T00:20:00Z"),
        endedAt: to,
      },
    ]);
  });

  test("同じ ms に現れて消えたゲームは区間を残さず、同じ ms の変化は seq の順に当てる", () => {
    // Arrange
    const service = new GameIntervalService();

    // Act
    const intervals = service.connect({
      from,
      to,
      closedAtFrom: [],
      updates: [
        update("2026-10-19T00:10:00Z", [], 2),
        update("2026-10-19T00:10:00Z", [valorant], 1),
      ],
    });

    // Assert
    expect(intervals).toStrictEqual([]);
  });
});
