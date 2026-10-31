import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, onTestFinished, test } from "vitest";

import type { Db } from "../../src/libs/db";

import { BasinSqlClient } from "../../src/client/basin-sql-client";
import { AggregationRunRepository } from "../../src/repository/aggregation-run-repository";
import { CustomStatusIntervalRepository } from "../../src/repository/custom-status-interval-repository";
import { CustomStatusIntervalService } from "../../src/service/custom-status-interval-service";
import { AggregateCustomStatusUseCase } from "../../src/use-case/aggregate-custom-status-use-case";
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
  return new AggregateCustomStatusUseCase({
    db,
    basin: new BasinSqlClient({ accountId: "account", bucket: "bucket", token: "token" }),
    runs: new AggregationRunRepository({ db }),
    intervals: new CustomStatusIntervalRepository({ db }),
    customStatuses: new CustomStatusIntervalService(),
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

// 実データのカスタムステータスの形（必要な field だけ）。
const working = { type: 4, name: "Custom Status", state: "作業中" };
// 絵文字だけのカスタムステータスは state が無い。
const emojiOnly = { type: 4, name: "Custom Status", emoji: { name: "🎮" } };
const twitch = { type: 1, name: "Twitch", url: "https://www.twitch.tv/alice" };

describe("AggregateCustomStatusUseCase", () => {
  test("activities の type 4 を文言ごとの区間にして書き、state の無いものは読まず、次の回で続きを延ばす", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    basin.use(
      http.post(endpoint, () =>
        rows([
          { received_at: "2026-10-19T00:10:00.000Z", activities: [working, emojiOnly, twitch] },
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
    expect(await db.query.customStatusIntervals.findMany()).toStrictEqual([
      {
        userId: "alice",
        state: "作業中",
        startedAt: new Date("2026-10-19T00:10:00Z"),
        endedAt: new Date("2026-10-19T02:00:00Z"),
      },
    ]);
    expect(
      await db.query.aggregationRuns.findFirst({
        where: (t, { eq }) => eq(t.name, "custom_status_intervals"),
      }),
    ).toMatchObject({ processedUntil: new Date("2026-10-19T02:00:00Z") });
  });
});
