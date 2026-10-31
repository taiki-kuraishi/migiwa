import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, onTestFinished, test } from "vitest";

import type { Db } from "../../src/libs/db";

import { BasinSqlClient } from "../../src/client/basin-sql-client";
import { AggregationRunRepository } from "../../src/repository/aggregation-run-repository";
import { StreamingIntervalRepository } from "../../src/repository/streaming-interval-repository";
import { StreamingIntervalService } from "../../src/service/streaming-interval-service";
import { AggregateStreamingUseCase } from "../../src/use-case/aggregate-streaming-use-case";
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
  return new AggregateStreamingUseCase({
    db,
    basin: new BasinSqlClient({ accountId: "account", bucket: "bucket", token: "token" }),
    runs: new AggregationRunRepository({ db }),
    intervals: new StreamingIntervalRepository({ db }),
    streamings: new StreamingIntervalService(),
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

// 実データの Twitch の activity の形（必要な field だけ）。
const twitch = {
  type: 1,
  name: "Twitch",
  url: "https://www.twitch.tv/alice",
  details: "ランク回す",
};
const spotify = { type: 2, name: "Spotify", sync_id: "track" };
// URL の無い type 1。schema の通り name を key にする。
const urlless = { type: 1, name: "Twitch" };

describe("AggregateStreamingUseCase", () => {
  test("activities の type 1 を配信ごとの区間にして書き、次の回で続きを延ばす", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    basin.use(
      http.post(endpoint, () =>
        rows([
          { received_at: "2026-10-19T00:10:00.000Z", activities: [twitch, spotify] },
          {
            received_at: "2026-10-19T00:50:00.000Z",
            activities: [{ ...twitch, details: "雑談" }, urlless],
          },
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
    const intervals = await db.query.streamingIntervals.findMany({
      orderBy: (t, { asc }) => [asc(t.startedAt)],
    });
    expect(intervals).toStrictEqual([
      {
        userId: "alice",
        streamingKey: "https://www.twitch.tv/alice",
        url: "https://www.twitch.tv/alice",
        name: "Twitch",
        details: "ランク回す",
        startedAt: new Date("2026-10-19T00:10:00Z"),
        endedAt: new Date("2026-10-19T02:00:00Z"),
      },
      {
        userId: "alice",
        streamingKey: "Twitch",
        url: null,
        name: "Twitch",
        details: null,
        startedAt: new Date("2026-10-19T00:50:00Z"),
        endedAt: new Date("2026-10-19T02:00:00Z"),
      },
    ]);
    expect(
      await db.query.aggregationRuns.findFirst({
        where: (t, { eq }) => eq(t.name, "streaming_intervals"),
      }),
    ).toMatchObject({ processedUntil: new Date("2026-10-19T02:00:00Z") });
  });
});
