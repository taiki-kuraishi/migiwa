import { describe, expect, test } from "bun:test";
import typia from "typia";

// Guards the wiring, not typia itself: if this fails, the ttsc preload did not run.
describe("typia through bun test", () => {
  test("validate<T>() was transformed", () => {
    expect(typia.validate<{ n: number }>({ n: 1 }).success).toBe(true);
    expect(typia.validate<{ n: number }>({ n: "x" }).success).toBe(false);
  });
});
