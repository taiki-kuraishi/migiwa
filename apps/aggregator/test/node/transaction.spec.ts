import { Result } from "better-result";
import { describe, expect, onTestFinished, test } from "vitest";

import { transaction } from "../../src/libs/db";
import { AggregationRunRepository } from "../../src/repository/aggregation-run-repository";
import { createTestDb } from "./db";

describe("transaction", () => {
  test("run が Err を返すと、run の中の書き込みを取り消してその Err を返す", async () => {
    // Arrange
    const db = await createTestDb({ onTestFinished });
    const repository = new AggregationRunRepository({ db });

    // Act
    const ran = await transaction({
      db,
      run: async (tx) => {
        await repository.advance({
          tx,
          name: "presence_intervals",
          from: undefined,
          to: new Date("2026-10-19T01:00:00Z"),
        });
        return Result.err("conflict");
      },
    });

    // Assert
    expect(ran.isErr() && ran.error).toBe("conflict");
    const found = await repository.findByName({ name: "presence_intervals" });
    expect(found.unwrap()).toBeUndefined();
  });
});
