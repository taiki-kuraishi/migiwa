import { describe, expect, test } from "bun:test";

import { validateDispatch, validateGatewayBotInfo, validateHello } from "../src/validate";

const dispatch = (t: string, d: unknown, s = 1) =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- tests need non-union `t`.
    validateDispatch({ op: 0, s, t, d } as Parameters<typeof validateDispatch>[0]),
  // Null when valid, otherwise the typia path of the first failure.
  failurePath = (result: {
    match: (m: { ok: () => null; err: (e: { path: string }) => string }) => string | null;
  }) => result.match({ ok: () => null, err: (error) => error.path });

describe("validateHello", () => {
  test("accepts heartbeat_interval and rejects anything else", () => {
    expect(validateHello({ heartbeat_interval: 41_250 }).unwrap()).toEqual({
      heartbeat_interval: 41_250,
    });
    expect(failurePath(validateHello({ heartbeat_interval: "soon" }))).toBe(
      "$input.heartbeat_interval",
    );
    expect(failurePath(validateHello(null))).toBe("$input");
  });
});

describe("validateGatewayBotInfo", () => {
  test("keeps url, shards and the two budget fields", () => {
    const info = validateGatewayBotInfo({
      url: "wss://gateway.discord.gg",
      shards: 1,
      session_start_limit: { total: 1000, remaining: 999, reset_after: 0, max_concurrency: 1 },
    }).unwrap();
    expect(info.shards).toBe(1);
    expect(info.session_start_limit.remaining).toBe(999);
  });

  test("rejects a missing budget", () => {
    expect(failurePath(validateGatewayBotInfo({ url: "wss://x", shards: 1 }))).toBe(
      "$input.session_start_limit",
    );
  });
});

describe("validateDispatch", () => {
  test("PRESENCE_UPDATE with the fields the rules read", () => {
    const result = dispatch("PRESENCE_UPDATE", {
        user: { id: "u1", username: "ignored" },
        guild_id: "g1",
        status: "online",
        activities: [{ name: "Game", type: 0, created_at: 1, application_id: "a" }],
        client_status: { desktop: "online" },
        extra: "kept",
      }),
      value = result.unwrap();
    expect(value.t).toBe("PRESENCE_UPDATE");
    if (value.t === "PRESENCE_UPDATE") {
      expect(value.d.user.id).toBe("u1");
    }
  });

  test("PRESENCE_UPDATE without user.id is malformed, with the path", () => {
    const result = dispatch("PRESENCE_UPDATE", { guild_id: "g1", status: "online" }),
      error = result.match({ ok: () => null, err: (e) => e });
    expect(result.isErr()).toBe(true);
    expect(error?.event).toBe("PRESENCE_UPDATE");
    expect(error?.path).toBe("$input.user");
  });

  test("VOICE_STATE_UPDATE may omit guild_id and self_stream", () => {
    const result = dispatch("VOICE_STATE_UPDATE", {
      user_id: "u1",
      session_id: "vs",
      channel_id: "c1",
      self_mute: false,
      self_deaf: false,
      mute: false,
      deaf: false,
      self_video: false,
      suppress: false,
    });
    expect(result.unwrap().t).toBe("VOICE_STATE_UPDATE");
  });

  test("GUILD_CREATE needs id, name, member_count, large, presences and voice_states", () => {
    const ok = dispatch("GUILD_CREATE", {
      id: "g1",
      name: "G",
      member_count: 3,
      large: false,
      presences: [],
      voice_states: [],
    });
    expect(ok.unwrap().t).toBe("GUILD_CREATE");
    expect(
      failurePath(
        dispatch("GUILD_CREATE", {
          id: "g1",
          name: "G",
          large: false,
          presences: [],
          voice_states: [],
        }),
      ),
    ).toBe("$input.member_count");
  });

  test("READY, RESUMED and GUILD_DELETE", () => {
    const ready = dispatch("READY", {
      v: 10,
      user: { id: "bot" },
      session_id: "s",
      resume_gateway_url: "wss://r",
      guilds: [{ id: "g1", unavailable: true }],
    });
    expect(ready.unwrap()).toMatchObject({ t: "READY", d: { session_id: "s" } });
    expect(dispatch("RESUMED", {}, 7).unwrap()).toEqual({ t: "RESUMED", s: 7 });
    expect(dispatch("GUILD_DELETE", { id: "g1", unavailable: true }).unwrap()).toMatchObject({
      t: "GUILD_DELETE",
      d: { id: "g1" },
    });
  });

  test("any other event passes through as OTHER without looking at d", () => {
    expect(dispatch("MESSAGE_CREATE", null, 9).unwrap()).toEqual({
      t: "OTHER",
      s: 9,
      name: "MESSAGE_CREATE",
    });
  });
});
