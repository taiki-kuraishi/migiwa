import { describe, expect, test } from "bun:test";

import { heartbeatPayload, identifyPayload, parseMessage, resumePayload } from "../src/payloads";

describe("parseMessage", () => {
  test("parses a dispatch with sequence and type", () => {
    const raw = JSON.stringify({ op: 0, d: { id: "1" }, s: 42, t: "READY" });
    expect(parseMessage(raw)).toEqual({ op: 0, d: { id: "1" }, s: 42, t: "READY" });
  });

  test("normalizes missing s and t to null", () => {
    expect(parseMessage(JSON.stringify({ op: 11 }))).toEqual({
      op: 11,
      d: undefined,
      s: null,
      t: null,
    });
  });

  test("returns null for non-string, invalid JSON and payloads without a numeric op", () => {
    expect(parseMessage(new ArrayBuffer(4))).toBeNull();
    expect(parseMessage("{not json")).toBeNull();
    expect(parseMessage(JSON.stringify({ d: 1 }))).toBeNull();
    expect(parseMessage(JSON.stringify(null))).toBeNull();
  });
});

describe("outgoing payloads", () => {
  test("identifyPayload carries token, intents and cloudflare properties", () => {
    expect(JSON.parse(identifyPayload("tok", 385))).toEqual({
      op: 2,
      d: {
        token: "tok",
        intents: 385,
        properties: { os: "cloudflare", browser: "migiwa", device: "migiwa" },
      },
    });
  });

  test("resumePayload carries token, session id and seq", () => {
    expect(JSON.parse(resumePayload("tok", "sess", 7))).toEqual({
      op: 6,
      d: { token: "tok", session_id: "sess", seq: 7 },
    });
  });

  test("heartbeatPayload sends the last seq or null", () => {
    expect(JSON.parse(heartbeatPayload(12))).toEqual({ op: 1, d: 12 });
    expect(JSON.parse(heartbeatPayload(null))).toEqual({ op: 1, d: null });
  });
});
