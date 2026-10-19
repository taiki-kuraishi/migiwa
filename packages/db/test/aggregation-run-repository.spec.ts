import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from "vite-plus/test";

import { AggregationRunRepository } from "../src/repository/aggregation-run-repository";
import * as schema from "../src/schema";

// 本番と同じ migration を当てる。schema から push すると、migration の書き忘れを見逃す。
async function createTestDb() {
  const client = createClient({ url: ":memory:" });
  onTestFinished(() => client.close());
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  return db;
}

describe("集計の実行記録の repository", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("upsert で作った実行記録を findByName で取り出せる", async () => {
    // Arrange
    const db = await createTestDb();
    const repository = new AggregationRunRepository({ db });
    vi.setSystemTime(new Date("2026-10-19T01:00:05Z"));

    // Act
    await repository.upsert({
      name: "presence_hourly",
      processedUntil: new Date("2026-10-19T01:00:00Z"),
    });

    // Assert
    const found = await repository.findByName({ name: "presence_hourly" });
    expect(found.unwrap()).toStrictEqual({
      name: "presence_hourly",
      processedUntil: new Date("2026-10-19T01:00:00Z"),
      updatedAt: new Date("2026-10-19T01:00:05Z"),
    });
  });

  test("既にある実行記録を upsert すると、処理済みの上限時刻と更新時刻が上書きされる", async () => {
    // Arrange
    const db = await createTestDb();
    const repository = new AggregationRunRepository({ db });
    vi.setSystemTime(new Date("2026-10-19T01:00:05Z"));
    await repository.upsert({
      name: "presence_hourly",
      processedUntil: new Date("2026-10-19T01:00:00Z"),
    });
    vi.setSystemTime(new Date("2026-10-19T02:00:05Z"));

    // Act
    const upserted = await repository.upsert({
      name: "presence_hourly",
      processedUntil: new Date("2026-10-19T02:00:00Z"),
    });

    // Assert
    expect(upserted.unwrap()).toStrictEqual({
      name: "presence_hourly",
      processedUntil: new Date("2026-10-19T02:00:00Z"),
      updatedAt: new Date("2026-10-19T02:00:05Z"),
    });
  });

  test("一度も実行していない集計名を findByName すると undefined を返す", async () => {
    // Arrange
    const db = await createTestDb();
    const repository = new AggregationRunRepository({ db });

    // Act
    const found = await repository.findByName({ name: "presence_hourly" });

    // Assert
    expect(found.unwrap()).toBeUndefined();
  });

  test("query が失敗すると AggregationRunQueryError を返す", async () => {
    // Arrange
    const db = await createTestDb();
    const repository = new AggregationRunRepository({ db });
    db.$client.close();

    // Act
    const found = await repository.findByName({ name: "presence_hourly" });

    // Assert
    expect(found).toMatchObject({ error: { _tag: "AggregationRunQueryError" } });
  });
});
