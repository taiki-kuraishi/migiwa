import { validateHello } from "@migiwa/gateway";
import typia from "typia";
import { expect, test } from "vitest";

// Guards the wiring inside the Workers pool.
// The Vite plugin must transform sources before they reach workerd.
test("validate<T>() was transformed for vitest", () => {
  expect(typia.validate<{ n: number }>({ n: 1 }).success).toBe(true);
  expect(typia.validate<{ n: number }>({ n: "x" }).success).toBe(false);
});

// @migiwa/gateway is reached through the apps/bot/node_modules symlink.
// @ttsc/unplugin skips any module id with a node_modules segment.
// This test proves the transform still reaches gateway code across that boundary.
// An untransformed validateHello() throws NoTransformConfigurationError instead of a Result.
test("gateway validators are transformed for vitest too", () => {
  expect(validateHello({ heartbeat_interval: 1 }).isOk()).toBe(true);
  expect(validateHello({ heartbeat_interval: "soon" }).isOk()).toBe(false);
});
