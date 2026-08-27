import { describe, expect, test } from "bun:test";

import { decideOnClose } from "../src/close-codes";

describe("decideOnClose", () => {
  test.each([
    [4004, "authentication_failed"],
    [4010, "invalid_shard"],
    [4011, "sharding_required"],
    [4012, "invalid_api_version"],
    [4013, "invalid_intents"],
    [4014, "disallowed_intents"],
  ])("code %i is fatal with reason %s", (code, reason) => {
    expect(decideOnClose(code)).toEqual({ kind: "fatal", reason });
  });

  test.each([4003, 4007, 4009])("code %i requires a fresh IDENTIFY", (code) => {
    expect(decideOnClose(code)).toEqual({ kind: "identify" });
  });

  test.each([1000, 1001, 1006, 4000, 4001, 4002, 4005, 4008, undefined])(
    "code %p can be resumed",
    (code) => {
      expect(decideOnClose(code)).toEqual({ kind: "resume" });
    },
  );
});
