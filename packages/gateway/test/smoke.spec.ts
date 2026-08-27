import { describe, expect, test } from "bun:test";

import { packageName } from "../src/smoke";

describe("@migiwa/gateway", () => {
  test("is wired up so the test pipeline has something to run", () => {
    expect(packageName()).toBe("@migiwa/gateway");
  });
});
