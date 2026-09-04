import { describe, expect, test } from "bun:test";

import { decideOnClose } from "../src/close";

describe("decideOnClose", () => {
  test("resumes when the socket closed without a code", () => {
    expect(decideOnClose(undefined)).toEqual({ kind: "resume" });
  });

  test("resumes on ordinary closes", () => {
    expect(decideOnClose(1006)).toEqual({ kind: "resume" });
    expect(decideOnClose(4000)).toEqual({ kind: "resume" });
  });

  test("identifies afresh when the session is gone", () => {
    expect(decideOnClose(4003)).toEqual({ kind: "identify" });
    expect(decideOnClose(4007)).toEqual({ kind: "identify" });
    expect(decideOnClose(4009)).toEqual({ kind: "identify" });
  });

  test("gives up on codes only a human can fix", () => {
    expect(decideOnClose(4004)).toEqual({ kind: "fatal", reason: "authentication_failed" });
    expect(decideOnClose(4011)).toEqual({ kind: "fatal", reason: "sharding_required" });
    expect(decideOnClose(4013)).toEqual({ kind: "fatal", reason: "invalid_intents" });
    expect(decideOnClose(4014)).toEqual({ kind: "fatal", reason: "disallowed_intents" });
  });
});
