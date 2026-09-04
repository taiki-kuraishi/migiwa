import { describe, expect, test } from "bun:test";

import { backoffDelayMs, invalidSessionDelayMs } from "../src/backoff";

describe("backoffDelayMs", () => {
  test("doubles from one second with ±25 % jitter", () => {
    expect(backoffDelayMs(0, () => 0)).toBe(750);
    expect(backoffDelayMs(0, () => 1)).toBe(1250);
    expect(backoffDelayMs(3, () => 0.5)).toBe(8000);
  });

  test("caps the base at five minutes", () => {
    expect(backoffDelayMs(20, () => 0.5)).toBe(300_000);
    expect(backoffDelayMs(20, () => 1)).toBe(375_000);
  });
});

describe("invalidSessionDelayMs", () => {
  test("waits between one and five seconds", () => {
    expect(invalidSessionDelayMs(() => 0)).toBe(1000);
    expect(invalidSessionDelayMs(() => 1)).toBe(5000);
  });
});
