import typia from "typia";
import { expect, test } from "vitest";

// Guards the wiring inside the Workers pool.
// The Vite plugin must transform sources before they reach workerd.
test("validate<T>() was transformed for vitest", () => {
  expect(typia.validate<{ n: number }>({ n: 1 }).success).toBe(true);
  expect(typia.validate<{ n: number }>({ n: "x" }).success).toBe(false);
});
