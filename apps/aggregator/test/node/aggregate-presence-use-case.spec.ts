import { Result } from "better-result";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, onTestFinished, test } from "vitest";

import type { Db } from "../../src/libs/db";

import { BasinSqlClient } from "../../src/client/basin-sql-client";
import { transaction } from "../../src/libs/db";
import { AggregationRunRepository } from "../../src/repository/aggregation-run-repository";
import { PresenceIntervalRepository } from "../../src/repository/presence-interval-repository";
import { PresenceIntervalService } from "../../src/service/presence-interval-service";
import { AggregatePresenceUseCase } from "../../src/use-case/aggregate-presence-use-case";
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
  return new AggregatePresenceUseCase({
    db,
    basin: new BasinSqlClient({ accountId: "account", bucket: "bucket", token: "token" }),
    runs: new AggregationRunRepository({ db }),
    intervals: new PresenceIntervalRepository({ db }),
    presence: new PresenceIntervalService(),
  });
}

// 前回の集計が 2026-10-19T00:00Z まで済み、alice が 23:10 から online のまま続いている状態を作る。
async function seedAliceOnline(db: Db) {
  await transaction({
    db,
    run: async (tx) =>
      Result.gen(async function* () {
        yield* await new AggregationRunRepository({ db }).advance({
          tx,
          name: "presence_intervals",
          from: undefined,
          to: new Date("2026-10-19T00:00:00Z"),
        });
        yield* await new PresenceIntervalRepository({ db }).upsert({
          tx,
          intervals: [
            {
              userId: "alice",
              status: "online",
              startedAt: new Date("2026-10-18T23:10:00Z"),
              endedAt: new Date("2026-10-19T00:00:00Z"),
            },
          ],
        });
        return Result.ok(undefined);
      }),
  });
}

// 各行は同じ session の dispatch で、順に seq を振る。
function rows(updates: { user_id: string; received_at: string; status: string }[]) {
  return HttpResponse.json({
    success: true,
    errors: [],
    result: {
      rows: updates.map((update, index) => ({ ...update, session_id: "session", seq: index })),
    },
  });
}

describe("AggregatePresenceUseCase", () => {
  test("未処理の時間の変化を、前回閉じた区間からつないで区間を書き、処理済みの上限時刻を進める", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    await seedAliceOnline(db);
    basin.use(
      http.post(endpoint, () =>
        rows([
          { user_id: "alice", received_at: "2026-10-19T00:10:00.000Z", status: "offline" },
          { user_id: "bob", received_at: "2026-10-19T00:30:00.000Z", status: "idle" },
          { user_id: "alice", received_at: "2026-10-19T00:40:00.000Z", status: "online" },
        ]),
      ),
    );

    // Act
    const result = await createUseCase(db).execute({
      now: new Date("2026-10-19T01:30:00Z"),
      delayMinutes: 15,
    });

    // Assert
    expect(result.unwrap()).toStrictEqual({
      from: new Date("2026-10-19T00:00:00Z"),
      to: new Date("2026-10-19T01:00:00Z"),
    });
    const intervals = await db.query.presenceIntervals.findMany({
      orderBy: (t, { asc }) => [asc(t.startedAt)],
    });
    expect(intervals).toStrictEqual([
      {
        userId: "alice",
        status: "online",
        startedAt: new Date("2026-10-18T23:10:00Z"),
        endedAt: new Date("2026-10-19T00:10:00Z"),
      },
      {
        userId: "alice",
        status: "offline",
        startedAt: new Date("2026-10-19T00:10:00Z"),
        endedAt: new Date("2026-10-19T00:40:00Z"),
      },
      {
        userId: "bob",
        status: "idle",
        startedAt: new Date("2026-10-19T00:30:00Z"),
        endedAt: new Date("2026-10-19T01:00:00Z"),
      },
      {
        userId: "alice",
        status: "online",
        startedAt: new Date("2026-10-19T00:40:00Z"),
        endedAt: new Date("2026-10-19T01:00:00Z"),
      },
    ]);
    expect(await db.query.aggregationRuns.findFirst()).toMatchObject({
      processedUntil: new Date("2026-10-19T01:00:00Z"),
    });
  });

  test("Basin に event が無い回が続いても、同じ状態の区間を 1 行のまま延ばす", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    await seedAliceOnline(db);
    basin.use(http.post(endpoint, () => rows([])));
    await createUseCase(db).execute({ now: new Date("2026-10-19T01:30:00Z"), delayMinutes: 15 });

    // Act
    await createUseCase(db).execute({ now: new Date("2026-10-19T02:30:00Z"), delayMinutes: 15 });

    // Assert
    expect(await db.query.presenceIntervals.findMany()).toStrictEqual([
      {
        userId: "alice",
        status: "online",
        startedAt: new Date("2026-10-18T23:10:00Z"),
        endedAt: new Date("2026-10-19T02:00:00Z"),
      },
    ]);
    expect(await db.query.aggregationRuns.findFirst()).toMatchObject({
      processedUntil: new Date("2026-10-19T02:00:00Z"),
    });
  });

  test("Basin の行が LIMIT の上限に達したら続きのページも読み、bind 変数の上限を超える行数も書く", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    await seedAliceOnline(db);
    // 1 行 4 個の bind 変数で書くと SQLite の上限（32766）を超える数の user にする。
    const firstPage = Array.from({ length: 10_000 }, (_, index) => ({
      user_id: `user-${index}`,
      received_at: new Date(Date.parse("2026-10-19T00:00:00Z") + index).toISOString(),
      status: "online",
    }));
    basin.use(
      http.post(endpoint, async ({ request }) => {
        const body = await request.text();
        return body.includes("received_at > '2026-10-19T00:00:09.999Z'")
          ? rows([{ user_id: "bob", received_at: "2026-10-19T00:59:00.000Z", status: "idle" }])
          : rows(firstPage);
      }),
    );

    // Act
    await createUseCase(db).execute({ now: new Date("2026-10-19T01:30:00Z"), delayMinutes: 15 });

    // Assert
    const intervals = await db.query.presenceIntervals.findMany();
    expect(intervals).toHaveLength(10_002);
    expect(intervals).toContainEqual({
      userId: "bob",
      status: "idle",
      startedAt: new Date("2026-10-19T00:59:00Z"),
      endedAt: new Date("2026-10-19T01:00:00Z"),
    });
  });

  test("集計の途中でほかの実行が同じ時間を書いたら、何も書かずに AggregationRunConflictError を返す", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    await seedAliceOnline(db);
    const now = new Date("2026-10-19T01:30:00Z");
    let overlapped = false;
    basin.use(
      http.post(endpoint, async () => {
        // 最初の実行が処理済みの上限時刻を読んだ後、書く前に、重なった cron が同じ時間を集計し終える。
        if (!overlapped) {
          overlapped = true;
          await createUseCase(db).execute({ now, delayMinutes: 15 });
        }
        return rows([
          { user_id: "alice", received_at: "2026-10-19T00:20:00.000Z", status: "idle" },
        ]);
      }),
    );

    // Act
    const result = await createUseCase(db).execute({ now, delayMinutes: 15 });

    // Assert
    expect(result).toMatchObject({ error: { _tag: "AggregationRunConflictError" } });
    expect(await db.query.presenceIntervals.findMany()).toStrictEqual([
      {
        userId: "alice",
        status: "online",
        startedAt: new Date("2026-10-18T23:10:00Z"),
        endedAt: new Date("2026-10-19T00:20:00Z"),
      },
      {
        userId: "alice",
        status: "idle",
        startedAt: new Date("2026-10-19T00:20:00Z"),
        endedAt: new Date("2026-10-19T01:00:00Z"),
      },
    ]);
  });
});
