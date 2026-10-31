import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, onTestFinished, test } from "vitest";

import type { Db } from "../../src/libs/db";

import { BasinSqlClient } from "../../src/client/basin-sql-client";
import { AggregationRunRepository } from "../../src/repository/aggregation-run-repository";
import { GameIntervalRepository } from "../../src/repository/game-interval-repository";
import { GameIntervalService } from "../../src/service/game-interval-service";
import { AggregateGameUseCase } from "../../src/use-case/aggregate-game-use-case";
import { createTestDb } from "./db";

const endpoint =
  "https://api.sql.cloudflarestorage.com/api/v1/accounts/account/basin-sql/query/bucket";

const basin = setupServer();

beforeAll(() => {
  basin.listen({ onUnhandledFrame: "error" });
});

afterEach(() => {
  basin.resetHandlers();
});

afterAll(() => {
  basin.close();
});

function createUseCase(db: Db) {
  return new AggregateGameUseCase({
    db,
    basin: new BasinSqlClient({ accountId: "account", bucket: "bucket", token: "token" }),
    runs: new AggregationRunRepository({ db }),
    intervals: new GameIntervalRepository({ db }),
    games: new GameIntervalService(),
  });
}

// 各行は同じ session の dispatch で、順に seq を振る。payload は Basin が json の列を返す形の文字列にする。
function rows(updates: { received_at: string; activities: unknown[] }[]) {
  return HttpResponse.json({
    success: true,
    errors: [],
    result: {
      rows: updates.map((update, index) => ({
        user_id: "alice",
        received_at: update.received_at,
        session_id: "session",
        seq: index,
        payload: JSON.stringify({ status: "online", activities: update.activities }),
      })),
    },
  });
}

// 実データで、同じ VALORANT が application_id と official_game_id を入れ替えた 2 つの activity として届く形。
const valorantRich = {
  type: 0,
  name: "VALORANT",
  application_id: "1443350165678198935",
  official_game_id: "700136079562375258",
};
const valorantMinimal = {
  type: 0,
  name: "VALORANT",
  application_id: "700136079562375258",
  official_game_id: "1443350165678198935",
};
const spotify = { type: 2, name: "Spotify", id: "spotify:1" };

describe("AggregateGameUseCase", () => {
  test("activities の type 0 を application_id ごとの区間にして書き、次の回で続きを延ばす", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    basin.use(
      http.post(endpoint, () =>
        rows([
          {
            received_at: "2026-10-19T00:10:00.000Z",
            activities: [valorantRich, valorantMinimal, spotify],
          },
          { received_at: "2026-10-19T00:40:00.000Z", activities: [valorantRich] },
        ]),
      ),
    );
    await createUseCase(db).execute({ now: new Date("2026-10-19T01:30:00Z"), delayMinutes: 15 });
    basin.use(http.post(endpoint, () => rows([])));

    // Act
    const result = await createUseCase(db).execute({
      now: new Date("2026-10-19T02:30:00Z"),
      delayMinutes: 15,
    });

    // Assert
    expect(result.unwrap()).toStrictEqual({
      from: new Date("2026-10-19T01:00:00Z"),
      to: new Date("2026-10-19T02:00:00Z"),
    });
    const intervals = await db.query.gameIntervals.findMany({
      orderBy: (t, { asc }) => [asc(t.startedAt), asc(t.gameKey)],
    });
    expect(intervals).toStrictEqual([
      {
        userId: "alice",
        gameKey: "1443350165678198935",
        applicationId: "1443350165678198935",
        officialGameId: "700136079562375258",
        name: "VALORANT",
        startedAt: new Date("2026-10-19T00:10:00Z"),
        endedAt: new Date("2026-10-19T02:00:00Z"),
      },
      {
        userId: "alice",
        gameKey: "700136079562375258",
        applicationId: "700136079562375258",
        officialGameId: "1443350165678198935",
        name: "VALORANT",
        startedAt: new Date("2026-10-19T00:10:00Z"),
        endedAt: new Date("2026-10-19T00:40:00Z"),
      },
    ]);
    expect(
      await db.query.aggregationRuns.findFirst({
        where: (t, { eq }) => eq(t.name, "game_intervals"),
      }),
    ).toMatchObject({ processedUntil: new Date("2026-10-19T02:00:00Z") });
  });

  test("Basin の行が LIMIT の上限に達したら、続きのページも読んで区間をつなぐ", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    const firstPage = Array.from({ length: 10_000 }, (_, index) => ({
      received_at: new Date(Date.parse("2026-10-19T00:00:00Z") + index).toISOString(),
      activities: [valorantRich],
    }));
    basin.use(
      http.post(endpoint, async ({ request }) => {
        const body = await request.text();
        return body.includes("received_at > '2026-10-19T00:00:09.999Z'")
          ? rows([{ received_at: "2026-10-19T00:59:00.000Z", activities: [] }])
          : rows(firstPage);
      }),
    );

    // Act
    await createUseCase(db).execute({ now: new Date("2026-10-19T01:30:00Z"), delayMinutes: 15 });

    // Assert
    expect(await db.query.gameIntervals.findMany()).toStrictEqual([
      {
        userId: "alice",
        gameKey: "1443350165678198935",
        applicationId: "1443350165678198935",
        officialGameId: "700136079562375258",
        name: "VALORANT",
        startedAt: new Date("2026-10-19T00:00:00Z"),
        endedAt: new Date("2026-10-19T00:59:00Z"),
      },
    ]);
  });

  test("activities を読めない行があれば、何も書かずに BasinSqlResponseError を返す", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    basin.use(
      http.post(endpoint, () =>
        HttpResponse.json({
          success: true,
          errors: [],
          result: {
            rows: [
              {
                user_id: "alice",
                received_at: "2026-10-19T00:10:00.000Z",
                session_id: "session",
                seq: 0,
                payload: JSON.stringify({ status: "online" }),
              },
            ],
          },
        }),
      ),
    );

    // Act
    const result = await createUseCase(db).execute({
      now: new Date("2026-10-19T01:30:00Z"),
      delayMinutes: 15,
    });

    // Assert
    expect(result).toMatchObject({ error: { _tag: "BasinSqlResponseError" } });
    expect(await db.query.gameIntervals.findMany()).toStrictEqual([]);
    expect(await db.query.aggregationRuns.findMany()).toStrictEqual([]);
  });
});
