import { describe, expect, onTestFinished, test } from "vitest";

import { transaction } from "../../src/libs/db";
import { PresenceIntervalRepository } from "../../src/repository/presence-interval-repository";
import { createTestDb } from "./db";

describe("presence の区間の repository", () => {
  test("upsert は同じ user・開始時刻の区間の終了時刻を延ばし、無い区間を作る", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    const repository = new PresenceIntervalRepository({ db });
    await transaction({
      db,
      run: async (tx) =>
        repository.upsert({
          tx,
          intervals: [
            {
              userId: "alice",
              status: "online",
              startedAt: new Date("2026-10-19T00:10:00Z"),
              endedAt: new Date("2026-10-19T01:00:00Z"),
            },
          ],
        }),
    });

    // Act
    await transaction({
      db,
      run: async (tx) =>
        repository.upsert({
          tx,
          intervals: [
            {
              userId: "alice",
              status: "online",
              startedAt: new Date("2026-10-19T00:10:00Z"),
              endedAt: new Date("2026-10-19T01:20:00Z"),
            },
            {
              userId: "alice",
              status: "offline",
              startedAt: new Date("2026-10-19T01:20:00Z"),
              endedAt: new Date("2026-10-19T02:00:00Z"),
            },
          ],
        }),
    });

    // Assert
    expect(await db.query.presenceIntervals.findMany()).toStrictEqual([
      {
        userId: "alice",
        status: "online",
        startedAt: new Date("2026-10-19T00:10:00Z"),
        endedAt: new Date("2026-10-19T01:20:00Z"),
      },
      {
        userId: "alice",
        status: "offline",
        startedAt: new Date("2026-10-19T01:20:00Z"),
        endedAt: new Date("2026-10-19T02:00:00Z"),
      },
    ]);
  });

  test("findEndingAt は、ちょうどその時刻で閉じた区間を返す", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    const repository = new PresenceIntervalRepository({ db });
    await transaction({
      db,
      run: async (tx) =>
        repository.upsert({
          tx,
          intervals: [
            {
              userId: "alice",
              status: "online",
              startedAt: new Date("2026-10-19T00:00:00Z"),
              endedAt: new Date("2026-10-19T00:30:00Z"),
            },
            {
              userId: "alice",
              status: "idle",
              startedAt: new Date("2026-10-19T00:30:00Z"),
              endedAt: new Date("2026-10-19T01:00:00Z"),
            },
          ],
        }),
    });

    // Act
    const found = await repository.findEndingAt({ endedAt: new Date("2026-10-19T01:00:00Z") });

    // Assert
    expect(found.unwrap()).toStrictEqual([
      {
        userId: "alice",
        status: "idle",
        startedAt: new Date("2026-10-19T00:30:00Z"),
        endedAt: new Date("2026-10-19T01:00:00Z"),
      },
    ]);
  });
});
