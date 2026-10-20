import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from "vitest";

import { transaction } from "../../src/libs/db";
import { AggregationRunRepository } from "../../src/repository/aggregation-run-repository";
import { createTestDb } from "./db";

describe("集計の実行記録の repository", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("実行記録が無いとき advance で作った実行記録を findByName で取り出せる", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    const repository = new AggregationRunRepository({ db });
    vi.setSystemTime(new Date("2026-10-19T01:00:05Z"));

    // Act
    await transaction({
      db,
      run: async (tx) =>
        repository.advance({
          tx,
          name: "presence_intervals",
          from: undefined,
          to: new Date("2026-10-19T01:00:00Z"),
        }),
    });

    // Assert
    const found = await repository.findByName({ name: "presence_intervals" });
    expect(found.unwrap()).toStrictEqual({
      name: "presence_intervals",
      processedUntil: new Date("2026-10-19T01:00:00Z"),
      updatedAt: new Date("2026-10-19T01:00:05Z"),
    });
  });

  test("読んだ値から advance すると、処理済みの上限時刻と更新時刻が進む", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    const repository = new AggregationRunRepository({ db });
    vi.setSystemTime(new Date("2026-10-19T01:00:05Z"));
    await transaction({
      db,
      run: async (tx) =>
        repository.advance({
          tx,
          name: "presence_intervals",
          from: undefined,
          to: new Date("2026-10-19T01:00:00Z"),
        }),
    });
    vi.setSystemTime(new Date("2026-10-19T02:00:05Z"));

    // Act
    const advanced = await transaction({
      db,
      run: async (tx) =>
        repository.advance({
          tx,
          name: "presence_intervals",
          from: new Date("2026-10-19T01:00:00Z"),
          to: new Date("2026-10-19T02:00:00Z"),
        }),
    });

    // Assert
    expect(advanced.unwrap()).toStrictEqual({
      name: "presence_intervals",
      processedUntil: new Date("2026-10-19T02:00:00Z"),
      updatedAt: new Date("2026-10-19T02:00:05Z"),
    });
  });

  test("ほかの実行が先に進めていると、advance は何も書かず undefined を返す", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    const repository = new AggregationRunRepository({ db });
    await transaction({
      db,
      run: async (tx) =>
        repository.advance({
          tx,
          name: "presence_intervals",
          from: undefined,
          to: new Date("2026-10-19T02:00:00Z"),
        }),
    });

    // Act
    const advanced = await transaction({
      db,
      run: async (tx) =>
        repository.advance({
          tx,
          name: "presence_intervals",
          from: new Date("2026-10-19T01:00:00Z"),
          to: new Date("2026-10-19T02:00:00Z"),
        }),
    });

    // Assert
    expect(advanced.unwrap()).toBeUndefined();
  });

  test("一度も実行していない集計名を findByName すると undefined を返す", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    const repository = new AggregationRunRepository({ db });

    // Act
    const found = await repository.findByName({ name: "presence_intervals" });

    // Assert
    expect(found.unwrap()).toBeUndefined();
  });

  test("query が失敗すると AggregationRunQueryError を返す", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    const repository = new AggregationRunRepository({ db });
    db.$client.close();

    // Act
    const found = await repository.findByName({ name: "presence_intervals" });

    // Assert
    expect(found).toMatchObject({ error: { _tag: "AggregationRunQueryError" } });
  });
});
