import { describe, expect, test } from "bun:test";

import { backoffDelayMs, invalidSessionDelayMs } from "../src/backoff";

const noJitter = () => 0;
const maxJitter = () => 0.999999;

describe("backoffDelayMs", () => {
  test("doubles from 1 s and caps at 5 min", () => {
    expect(backoffDelayMs(0, noJitter)).toBe(1000);
    expect(backoffDelayMs(1, noJitter)).toBe(2000);
    expect(backoffDelayMs(4, noJitter)).toBe(16_000);
    expect(backoffDelayMs(9, noJitter)).toBe(300_000);
    expect(backoffDelayMs(50, noJitter)).toBe(300_000);
  });

  test("adds up to 1 s of jitter and always returns an integer", () => {
    const delay = backoffDelayMs(0, maxJitter);
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThan(2000);
    expect(Number.isInteger(delay)).toBe(true);
  });

  test("treats negative attempts as the first attempt", () => {
    expect(backoffDelayMs(-3, noJitter)).toBe(1000);
  });
});

describe("invalidSessionDelayMs", () => {
  test("stays within Discord's 1-5 s window", () => {
    expect(invalidSessionDelayMs(noJitter)).toBe(1000);
    const upper = invalidSessionDelayMs(maxJitter);
    expect(upper).toBeGreaterThanOrEqual(4999);
    expect(upper).toBeLessThan(5000);
    expect(Number.isInteger(upper)).toBe(true);
  });
});
