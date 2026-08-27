import { describe, expect, test } from "bun:test";

import { Intent, intentsFor } from "../src/intents";

describe("intentsFor", () => {
  test("always requests GUILDS and GUILD_VOICE_STATES", () => {
    expect(intentsFor(new Set())).toBe(Intent.Guilds | Intent.GuildVoiceStates);
  });

  test("adds GUILD_PRESENCES only when PRESENCE_UPDATE is allowlisted", () => {
    expect(intentsFor(new Set(["VOICE_STATE_UPDATE"]))).toBe(
      Intent.Guilds | Intent.GuildVoiceStates,
    );
    expect(intentsFor(new Set(["PRESENCE_UPDATE", "VOICE_STATE_UPDATE"]))).toBe(
      Intent.Guilds | Intent.GuildVoiceStates | Intent.GuildPresences,
    );
  });

  test("uses the documented bit positions", () => {
    expect(Intent.Guilds).toBe(1);
    expect(Intent.GuildVoiceStates).toBe(128);
    expect(Intent.GuildPresences).toBe(256);
  });
});
