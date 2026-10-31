import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, onTestFinished, test } from "vitest";

import type { Db } from "../../src/libs/db";

import { BasinSqlClient } from "../../src/client/basin-sql-client";
import { AggregationRunRepository } from "../../src/repository/aggregation-run-repository";
import { ListeningIntervalRepository } from "../../src/repository/listening-interval-repository";
import { ListeningIntervalService } from "../../src/service/listening-interval-service";
import { AggregateListeningUseCase } from "../../src/use-case/aggregate-listening-use-case";
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
  return new AggregateListeningUseCase({
    db,
    basin: new BasinSqlClient({ accountId: "account", bucket: "bucket", token: "token" }),
    runs: new AggregationRunRepository({ db }),
    intervals: new ListeningIntervalRepository({ db }),
    listenings: new ListeningIntervalService(),
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

// 実データの Spotify の activity の形（必要な field だけ）。
const royal = {
  type: 2,
  name: "Spotify",
  sync_id: "5uBLK8BWV6PN3KZPUhuSzu",
  details: "MONTAGEM ROYAL",
  state: "NUEKI; Mc Menor Do Alvorada",
};
const valorant = { type: 0, name: "VALORANT", application_id: "700136079562375258" };
// 実データで sync_id も details も無い type 2（bot の m!help）。
const help = { type: 2, name: "m!help" };

describe("AggregateListeningUseCase", () => {
  test("activities の type 2 を曲ごとの区間にして書き、次の回で続きを延ばす", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    basin.use(
      http.post(endpoint, () =>
        rows([
          { received_at: "2026-10-19T00:10:00.000Z", activities: [royal, valorant] },
          { received_at: "2026-10-19T00:50:00.000Z", activities: [help] },
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
    const intervals = await db.query.listeningIntervals.findMany({
      orderBy: (t, { asc }) => [asc(t.startedAt)],
    });
    expect(intervals).toStrictEqual([
      {
        userId: "alice",
        listeningKey: "5uBLK8BWV6PN3KZPUhuSzu",
        syncId: "5uBLK8BWV6PN3KZPUhuSzu",
        name: "Spotify",
        details: "MONTAGEM ROYAL",
        state: "NUEKI; Mc Menor Do Alvorada",
        startedAt: new Date("2026-10-19T00:10:00Z"),
        endedAt: new Date("2026-10-19T00:50:00Z"),
      },
      {
        userId: "alice",
        listeningKey: "m!help",
        syncId: null,
        name: "m!help",
        details: null,
        state: null,
        startedAt: new Date("2026-10-19T00:50:00Z"),
        endedAt: new Date("2026-10-19T02:00:00Z"),
      },
    ]);
    expect(
      await db.query.aggregationRuns.findFirst({
        where: (t, { eq }) => eq(t.name, "listening_intervals"),
      }),
    ).toMatchObject({ processedUntil: new Date("2026-10-19T02:00:00Z") });
  });
});
