import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { BotObject } from "../src/bot-object";

import { GatewayStateRepository } from "../src/repository/gateway-state-repository";
import { gatewayHost, mockDiscord, resumeHost } from "./mock-discord";
import { network } from "./network";

// Gateway の往復は workerd の中の実時間で進み、再接続は backoff（最大 1 秒）や op 9 の待ち（最大 5 秒）を挟む。
const poll = { timeout: 10_000, interval: 20 };

let currentBot: DurableObjectStub<BotObject> | null = null;
let stopDiscord = () => {};

async function waitForState(args: { bot: DurableObjectStub<BotObject>; state: string }) {
  await vi.waitFor(async () => {
    const status = await args.bot.status();
    expect(status.state).toBe(args.state);
  }, poll);
}

// テストごとに別の Durable Object を使い、前のテストの socket や alarm と混ざらないようにする。
// mock の socket はその DO の I/O なので、テストから送る・閉じるときは runInDurableObject の中で行う。
function createBot() {
  currentBot = env.BOT.get(env.BOT.idFromName(crypto.randomUUID()));
  return currentBot;
}

function useDiscord(args: Parameters<typeof mockDiscord>[0]) {
  const discord = mockDiscord(args);
  stopDiscord = discord.stop;
  network.use(...discord.handlers);
  return discord;
}

async function connect(args: Parameters<typeof mockDiscord>[0]) {
  const discord = useDiscord(args);
  const connected = createBot();
  await connected.ensureConnected();
  await waitForState({ bot: connected, state: "connected" });
  return { discord, bot: connected };
}

async function storeSession(stub: DurableObjectStub<BotObject>) {
  await runInDurableObject(stub, (_instance, state) => {
    new GatewayStateRepository({ storage: state.storage.kv }).save({
      sessionId: "stored-session",
      sequence: 42,
      resumeUrl: `wss://${resumeHost}`,
      gatewayUrl: `wss://${gatewayHost}`,
    });
  });
}

// 前のテストの bot が再接続で本物の Discord へ出ていかないよう、止まったのを見届けてから handler を外す。
afterEach(async () => {
  if (currentBot !== null) {
    await runInDurableObject(currentBot, () => {
      stopDiscord();
    });
    await waitForState({ bot: currentBot, state: "stopped" });
    currentBot = null;
  }
  stopDiscord = () => {};
  vi.restoreAllMocks();
  network.resetHandlers();
});

describe("start", () => {
  test("logs and stays idle when the bot token cannot be read", async () => {
    // Arrange
    const errors = vi.spyOn(console, "error");
    vi.spyOn(env.DISCORD_BOT_TOKEN, "get").mockRejectedValue(new Error("Secret not found"));
    // 接続しないので、片付けで止まるのを待つ createBot() を使わない。
    const bot = env.BOT.get(env.BOT.idFromName(crypto.randomUUID()));

    // Act
    await bot.ensureConnected();

    // Assert
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Failed to read the bot token",
        error: expect.objectContaining({ _tag: "BotTokenReadError" }),
      }),
    );
    const status = await bot.status();
    expect(status.state).toBe("idle");
  });
});

describe("dispatch", () => {
  test.each([
    {
      t: "MESSAGE_CREATE",
      d: { id: "message", guild_id: "guild", channel_id: "channel", author: { id: "author" } },
      ids: { guild_id: "guild", channel_id: "channel", user_id: "author" },
    },
    {
      t: "GUILD_CREATE",
      d: { id: "guild", members: [{ user: { id: "member" } }] },
      ids: { guild_id: "guild", channel_id: null, user_id: null },
    },
    {
      t: "GUILD_SCHEDULED_EVENT_CREATE",
      d: { id: "scheduled-event", guild_id: "guild", channel_id: "channel" },
      ids: { guild_id: "guild", channel_id: "channel", user_id: null },
    },
    {
      t: "CHANNEL_CREATE",
      d: { id: "channel", guild_id: "guild" },
      ids: { guild_id: "guild", channel_id: "channel", user_id: null },
    },
    {
      t: "THREAD_MEMBERS_UPDATE",
      d: { id: "thread", guild_id: "guild", added_members: [{ user_id: "member" }] },
      ids: { guild_id: "guild", channel_id: "thread", user_id: null },
    },
    {
      t: "MESSAGE_REACTION_ADD",
      d: { user_id: "reactor", member: { user: { id: "member" } }, message_id: "message" },
      ids: { guild_id: null, channel_id: null, user_id: "reactor" },
    },
    {
      t: "INTERACTION_CREATE",
      d: { id: "interaction", member: { user: { id: "member" } } },
      ids: { guild_id: null, channel_id: null, user_id: "member" },
    },
    {
      t: "PRESENCE_UPDATE",
      d: { user: { id: "user" }, guild_id: "guild" },
      ids: { guild_id: "guild", channel_id: null, user_id: "user" },
    },
  ])("sends $t to the stream as a record with the IDs outside arrays", async ({ t, d, ids }) => {
    // Arrange
    const sent = vi.spyOn(env.EVENTS, "send").mockResolvedValue(undefined);
    const connected = await connect({ sessionId: "session-record" });

    // Act
    await runInDurableObject(connected.bot, () => {
      connected.discord.send({ op: 0, t, s: 2, d });
    });

    // Assert
    await vi.waitFor(() => {
      expect(sent.mock.calls.at(-1)?.[0]).toEqual([
        {
          received_at: expect.any(Number),
          type: t,
          session_id: "session-record",
          seq: 2,
          ...ids,
          payload: d,
        },
      ]);
    }, poll);
  });

  test("logs a dispatch the stream rejects and keeps recording the next one", async () => {
    // Arrange
    const errors = vi.spyOn(console, "error");
    const sent = vi.spyOn(env.EVENTS, "send").mockResolvedValue(undefined);
    const connected = await connect({ sessionId: "session-send-failure" });
    sent.mockRejectedValueOnce(new Error("stream unavailable"));

    // Act
    await runInDurableObject(connected.bot, () => {
      connected.discord.send({ op: 0, t: "TYPING_START", s: 2, d: { user_id: "user-1" } });
      connected.discord.send({ op: 0, t: "TYPING_START", s: 3, d: { user_id: "user-2" } });
    });

    // Assert
    await vi.waitFor(() => {
      expect(sent.mock.calls.at(-1)?.[0]).toMatchObject([{ seq: 3, user_id: "user-2" }]);
    }, poll);
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Failed to record a dispatch",
        sequence: 2,
        error: expect.objectContaining({ _tag: "EventSendError" }),
      }),
    );
  });

  test("logs a dispatch without a type instead of sending it", async () => {
    // Arrange
    const errors = vi.spyOn(console, "error");
    const connected = await connect({ sessionId: "session-invalid" });

    // Act
    await runInDurableObject(connected.bot, () => {
      connected.discord.send({ op: 0, s: 2, d: { channel_id: "channel-1" } });
    });

    // Assert
    await vi.waitFor(() => {
      expect(errors).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Failed to record a dispatch",
          sequence: 2,
          error: expect.objectContaining({ _tag: "EventRecordInvalidError", columns: ["type"] }),
        }),
      );
    }, poll);
  });
});

describe("stalled stream", () => {
  test("keeps sending heartbeats from the alarm while a record send hangs", async () => {
    // Arrange
    vi.spyOn(env.EVENTS, "send").mockImplementation(
      async () => Promise.withResolvers<undefined>().promise,
    );
    const discord = useDiscord({ sessionId: "session-stalled", heartbeatInterval: 100 });
    const bot = createBot();
    await bot.ensureConnected();
    await waitForState({ bot, state: "connected" });

    // Act
    await runInDurableObject(bot, () => {
      discord.send({ op: 0, t: "TYPING_START", s: 2, d: { user_id: "user-1" } });
    });

    // Assert
    await vi.waitFor(() => {
      const heartbeats = discord.connections[0]?.frames.filter((frame) => frame.d === 2);
      expect(heartbeats?.slice(0, 2)).toEqual([
        { op: 1, d: 2 },
        { op: 1, d: 2 },
      ]);
    }, poll);
  });
});

describe("heartbeat", () => {
  test("sends the last sequence from the alarm at every HELLO interval", async () => {
    // Arrange
    const discord = useDiscord({ sessionId: "session-heartbeat", heartbeatInterval: 100 });

    // Act
    await createBot().ensureConnected();

    // Assert
    await vi.waitFor(() => {
      const heartbeats = discord.connections[0]?.frames.filter((frame) => frame.op === 1);
      expect(heartbeats?.slice(0, 3)).toEqual([
        { op: 1, d: 1 },
        { op: 1, d: 1 },
        { op: 1, d: 1 },
      ]);
    }, poll);
  });

  test("closes with 4000 and resumes on the resume URL when a heartbeat gets no ACK", async () => {
    // Arrange
    const discord = useDiscord({
      sessionId: "session-zombie",
      heartbeatInterval: 100,
      ackHeartbeats: false,
    });

    // Act
    await createBot().ensureConnected();

    // Assert
    await vi.waitFor(() => {
      expect(discord.connections[1]?.frames[0]).toEqual({
        op: 6,
        d: { token: "test-token", session_id: "session-zombie", seq: 1 },
      });
    }, poll);
    expect(discord.connections.map((connection) => connection.host)).toEqual([
      gatewayHost,
      resumeHost,
    ]);
    expect(discord.connections[0]?.closeCodes).toEqual([4000]);
  });
});

describe("reconnect", () => {
  test("resumes on the resume URL after the backoff when Discord closes the socket", async () => {
    // Arrange
    const connected = await connect({ sessionId: "session-closed" });
    const closedAt = Date.now();

    // Act
    await runInDurableObject(connected.bot, () => {
      connected.discord.close(4000);
    });

    // Assert
    await vi.waitFor(() => {
      expect(connected.discord.connections[1]?.frames[0]).toEqual({
        op: 6,
        d: { token: "test-token", session_id: "session-closed", seq: 1 },
      });
    }, poll);
    // 最初の backoff は 1 秒の 1/2〜1。
    expect(Date.now() - closedAt).toBeGreaterThanOrEqual(500);
    expect(connected.discord.connections[1]?.host).toBe(resumeHost);
  });
});

describe("hello", () => {
  test("closes with 4000 and connects again when HELLO does not arrive in time", async () => {
    // Arrange
    const discord = useDiscord({ sessionId: "session-hello", helloOnFirstConnection: false });

    // Act
    await createBot().ensureConnected();

    // Assert
    // HELLO の待ちは 5 秒、その後の backoff は最大 1 秒。
    await vi.waitFor(
      () => {
        expect(discord.connections[1]?.frames[0]).toMatchObject({ op: 2 });
      },
      { ...poll, timeout: 15_000 },
    );
    expect(discord.connections[0]?.closeCodes).toEqual([4000]);
  });
});

describe("handshake", () => {
  test("logs each IDENTIFY it sends without the token", async () => {
    // Arrange
    const logs = vi.spyOn(console, "log");

    // Act
    await connect({ sessionId: "session-identify-log" });

    // Assert
    expect(logs).toHaveBeenCalledWith({ message: "Gateway IDENTIFY sent" });
  });
});

describe("restart", () => {
  test("resumes the session stored before the object restarted", async () => {
    // Arrange
    const discord = useDiscord({ sessionId: "unused" });
    const bot = createBot();
    await storeSession(bot);

    // Act
    await bot.ensureConnected();

    // Assert
    await waitForState({ bot, state: "connected" });
    expect(discord.connections[0]?.host).toBe(resumeHost);
    expect(discord.connections[0]?.frames[0]).toEqual({
      op: 6,
      d: { token: "test-token", session_id: "stored-session", seq: 42 },
    });
  });

  test("identifies on the gateway URL when Discord rejects the stored session", async () => {
    // Arrange
    const discord = useDiscord({ sessionId: "session-new", resumable: false });
    const bot = createBot();
    await storeSession(bot);

    // Act
    await bot.ensureConnected();

    // Assert
    await waitForState({ bot, state: "connected" });
    expect(discord.connections.map((connection) => connection.host)).toEqual([
      resumeHost,
      gatewayHost,
    ]);
    expect(discord.connections[1]?.frames[0]).toMatchObject({ op: 2, d: { token: "test-token" } });
  });
});
