import { describe, expect, test } from "bun:test";
import { GatewayDispatchEvents } from "discord-api-types/gateway/v10";

import { parseGatewayMessage } from "../src/envelope";

// Null when the frame parsed, otherwise the MalformedFrame reason.
const reasonOf = (raw: unknown): string | null =>
  parseGatewayMessage(raw).match({ ok: () => null, err: (error) => error.reason });

describe("parseGatewayMessage", () => {
  test("accepts a dispatch and keeps d untouched", () => {
    const message = parseGatewayMessage(
      JSON.stringify({ op: 0, s: 42, t: "READY", d: { v: 10, session_id: "s" } }),
    );
    expect(message.isOk()).toBe(true);
    expect(message.unwrap().op).toBe(0);
    expect(message.unwrap().s).toBe(42);
    expect(message.unwrap().t).toBe(GatewayDispatchEvents.Ready);
    expect(message.unwrap().d as unknown).toEqual({ v: 10, session_id: "s" });
  });

  test("accepts a hello whose s and t are null", () => {
    expect(
      reasonOf(JSON.stringify({ op: 10, s: null, t: null, d: { heartbeat_interval: 41_250 } })),
    ).toBeNull();
  });

  test("rejects binary frames", () => {
    expect(reasonOf(new ArrayBuffer(4))).toBe("binary");
  });

  test("rejects invalid JSON", () => {
    expect(reasonOf("{not json")).toBe("invalid_json");
  });

  test("rejects a missing or non-numeric op", () => {
    expect(reasonOf(JSON.stringify({ s: null, t: null, d: null }))).toBe("bad_op");
    expect(reasonOf(JSON.stringify({ op: "0", s: null, t: null }))).toBe("bad_op");
  });

  test("rejects a non-numeric s or a non-string t", () => {
    expect(reasonOf(JSON.stringify({ op: 0, s: "1", t: "READY" }))).toBe("bad_s");
    expect(reasonOf(JSON.stringify({ op: 0, s: 1, t: 5 }))).toBe("bad_t");
    expect(reasonOf(JSON.stringify({ op: 0, t: "READY" }))).toBe("bad_s");
  });

  test("rejects non-object JSON", () => {
    expect(reasonOf("42")).toBe("not_object");
    expect(reasonOf("null")).toBe("not_object");
  });
});
