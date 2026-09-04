import { describe, expect, test } from "bun:test";
import { GatewayIntentBits, GatewayOpcodes } from "discord-api-types/v10";

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
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse returns any.
    const payload = JSON.parse(identifyPayload("tok")) as {
      op: number;
      d: { token: string; intents: number; properties: Record<string, string> };
    };
    expect(payload.op).toBe(GatewayOpcodes.Identify);
    expect(payload.d.token).toBe("tok");
    expect(payload.d.intents).toBe(INTENTS);
    expect(payload.d.properties.browser).toBe("migiwa");
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
