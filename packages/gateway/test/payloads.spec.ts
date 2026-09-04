import { describe, expect, test } from "bun:test";
import { GatewayIntentBits, GatewayOpcodes } from "discord-api-types/gateway/v10";

import { heartbeatPayload, identifyPayload, INTENTS, resumePayload } from "../src/payloads";

describe("payloads", () => {
  test("INTENTS are guilds, voice states and presences", () => {
    // oxlint-disable no-bitwise -- exercising the same bit field construction as INTENTS.
    expect(INTENTS).toBe(
      GatewayIntentBits.Guilds |
        GatewayIntentBits.GuildVoiceStates |
        GatewayIntentBits.GuildPresences,
    );
    // oxlint-enable no-bitwise
  });

  test("identify carries the token and the fixed intents", () => {
    // Whole-object, like the resume and heartbeat tests below.
    // A field-by-field assertion would miss a stray extra field such as `compress: true`.
    // That would make Discord send binary frames, which the envelope guard drops as "binary".
    expect(JSON.parse(identifyPayload("tok"))).toEqual({
      op: GatewayOpcodes.Identify,
      d: {
        token: "tok",
        intents: INTENTS,
        properties: { os: "cloudflare-workers", browser: "migiwa", device: "migiwa" },
      },
    });
  });

  test("resume carries session id and seq", () => {
    expect(JSON.parse(resumePayload("tok", "sess", 7))).toEqual({
      op: GatewayOpcodes.Resume,
      d: { token: "tok", session_id: "sess", seq: 7 },
    });
  });

  test("heartbeat carries the last seq or null", () => {
    expect(JSON.parse(heartbeatPayload(3))).toEqual({ op: GatewayOpcodes.Heartbeat, d: 3 });
    expect(JSON.parse(heartbeatPayload(null))).toEqual({ op: GatewayOpcodes.Heartbeat, d: null });
  });
});
