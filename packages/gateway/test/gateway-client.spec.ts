import { GatewayDispatchEvents, GatewayOpcodes } from "discord-api-types/v10";
import { describe, expect, test } from "vite-plus/test";

import { GatewayClient } from "../src/gateway-client";

const now = 1_000_000;
const gatewayUrl = "wss://gateway.discord.gg";
const resumeUrl = "wss://gateway-us-east1-b.discord.gg";
const freshState = { sessionId: null, sequence: null, resumeUrl: null, gatewayUrl };
const resumableState = { sessionId: "session-1", sequence: 42, resumeUrl, gatewayUrl };

const createClient = (args: { state: typeof freshState | typeof resumableState }) =>
  new GatewayClient({
    token: "bot-token",
    intents: 513,
    state: args.state,
    now: () => now,
    random: () => 0.5,
  });

const hello = JSON.stringify({ op: GatewayOpcodes.Hello, d: { heartbeat_interval: 40_000 } });
const ready = JSON.stringify({
  op: GatewayOpcodes.Dispatch,
  t: GatewayDispatchEvents.Ready,
  s: 1,
  d: { session_id: "session-2", resume_gateway_url: resumeUrl },
});
const messageCreate = JSON.stringify({
  op: GatewayOpcodes.Dispatch,
  t: GatewayDispatchEvents.MessageCreate,
  s: 2,
  d: { id: "message-1" },
});

// IDENTIFY して READY ともう 1 つの dispatch を受け取り、heartbeat を予約済みの client。
const createReadyClient = () => {
  const client = createClient({ state: freshState });
  client.start();
  client.connected();
  client.received(hello);
  client.received(ready);
  client.received(messageCreate);
  return client;
};

describe("start で接続を始める", () => {
  test("session が保存されていなければ、gateway URL に接続して IDENTIFY する", () => {
    // Arrange
    const client = createClient({ state: freshState });

    // Act
    const outputs = client.start();

    // Assert
    expect(outputs).toEqual([
      { type: "reconnect", at: now, url: `${gatewayUrl}/?v=10&encoding=json`, resume: false },
    ]);
  });

  test("session が保存されていれば、resume URL に接続して RESUME する", () => {
    // Arrange
    const client = createClient({ state: resumableState });

    // Act
    const outputs = client.start();

    // Assert
    expect(outputs).toEqual([
      { type: "reconnect", at: now, url: `${resumeUrl}/?v=10&encoding=json`, resume: true },
    ]);
  });
});

describe("HELLO を受け取る", () => {
  test("IDENTIFY を送り、最初の heartbeat を jitter をかけた間隔の後に予約する", () => {
    // Arrange
    const client = createClient({ state: freshState });
    client.start();
    client.connected();

    // Act
    const outputs = client.received(hello);

    // Assert
    expect(outputs).toEqual([
      {
        type: "send",
        payload: {
          op: GatewayOpcodes.Identify,
          d: {
            token: "bot-token",
            intents: 513,
            properties: { os: "linux", browser: "migiwa", device: "migiwa" },
          },
        },
      },
      { type: "scheduleHeartbeat", at: now + 20_000 },
    ]);
  });

  test("保存された session と sequence で RESUME を送る", () => {
    // Arrange
    const client = createClient({ state: resumableState });
    client.start();
    client.connected();

    // Act
    const outputs = client.received(hello);

    // Assert
    expect(outputs[0]).toEqual({
      type: "send",
      payload: {
        op: GatewayOpcodes.Resume,
        d: { token: "bot-token", session_id: "session-1", seq: 42 },
      },
    });
  });
});

describe("dispatch を受け取る", () => {
  test("READY で session ID・sequence・resume URL を保存する", () => {
    // Arrange
    const client = createClient({ state: freshState });
    client.start();
    client.connected();
    client.received(hello);

    // Act
    const outputs = client.received(ready);

    // Assert
    expect(outputs).toMatchObject([
      {
        type: "dispatch",
        event: {
          type: GatewayDispatchEvents.Ready,
          sequence: 1,
          sessionId: "session-2",
          data: { session_id: "session-2", resume_gateway_url: resumeUrl },
        },
      },
    ]);
    expect(client.state).toEqual({ sessionId: "session-2", sequence: 1, resumeUrl, gatewayUrl });
  });

  test("以降の event を session ID 付きで渡し、sequence を進める", () => {
    // Arrange
    const client = createClient({ state: freshState });
    client.start();
    client.connected();
    client.received(hello);
    client.received(ready);

    // Act
    const outputs = client.received(messageCreate);

    // Assert
    expect(outputs).toEqual([
      {
        type: "dispatch",
        event: {
          type: GatewayDispatchEvents.MessageCreate,
          sequence: 2,
          sessionId: "session-2",
          data: { id: "message-1" },
        },
      },
    ]);
    expect(client.state.sequence).toBe(2);
  });
});

describe("heartbeat を送る", () => {
  test("前回に ACK が返っていれば、最後の sequence を送り次を予約する", () => {
    // Arrange
    const client = createReadyClient();

    // Act
    const outputs = client.heartbeatDue();

    // Assert
    expect(outputs).toEqual([
      { type: "send", payload: { op: GatewayOpcodes.Heartbeat, d: 2 } },
      { type: "scheduleHeartbeat", at: now + 40_000 },
    ]);
  });

  test("前回の heartbeat に ACK が無ければ、resume できる code で閉じ、backoff の後に RESUME する", () => {
    // Arrange
    const client = createReadyClient();
    client.heartbeatDue();

    // Act
    const outputs = client.heartbeatDue();

    // Assert
    expect(outputs).toEqual([
      { type: "disconnect", code: 4000 },
      { type: "reconnect", at: now + 750, url: `${resumeUrl}/?v=10&encoding=json`, resume: true },
    ]);
  });

  test("次の heartbeat までに ACK が届けば、接続を保つ", () => {
    // Arrange
    const client = createReadyClient();
    client.heartbeatDue();
    client.received(JSON.stringify({ op: GatewayOpcodes.HeartbeatAck }));

    // Act
    const outputs = client.heartbeatDue();

    // Assert
    expect(outputs[0]).toEqual({ type: "send", payload: { op: GatewayOpcodes.Heartbeat, d: 2 } });
  });

  test("heartbeat の要求にはすぐ応える", () => {
    // Arrange
    const client = createReadyClient();

    // Act
    const outputs = client.received(JSON.stringify({ op: GatewayOpcodes.Heartbeat, d: null }));

    // Assert
    expect(outputs).toEqual([{ type: "send", payload: { op: GatewayOpcodes.Heartbeat, d: 2 } }]);
  });
});

describe("frame を受け取る", () => {
  test.each(["not json", "null", "42", '{"d":null}', '{"op":"10"}'])(
    "payload でない frame を受け取ると、resume できる code で閉じ、backoff の後に RESUME する: %s",
    (text) => {
      // Arrange
      const client = createReadyClient();

      // Act
      const outputs = client.received(text);

      // Assert
      expect(outputs).toEqual([
        { type: "disconnect", code: 4000 },
        { type: "reconnect", at: now + 750, url: `${resumeUrl}/?v=10&encoding=json`, resume: true },
      ]);
    },
  );

  test("socket が開く前の frame と heartbeat は無視する", () => {
    // Arrange
    const client = createClient({ state: freshState });
    client.start();

    // Act
    const outputs = [...client.received(hello), ...client.heartbeatDue()];

    // Assert
    expect(outputs).toEqual([]);
  });
});

describe("op 7 reconnect を受け取る", () => {
  test("resume できる code で閉じ、resume URL で RESUME する", () => {
    // Arrange
    const client = createReadyClient();

    // Act
    const outputs = client.received(JSON.stringify({ op: GatewayOpcodes.Reconnect, d: null }));

    // Assert
    expect(outputs).toEqual([
      { type: "disconnect", code: 4000 },
      { type: "reconnect", at: now, url: `${resumeUrl}/?v=10&encoding=json`, resume: true },
    ]);
  });
});

describe("op 9 invalid session を受け取る", () => {
  test("d が true なら、1〜5 秒待ってから RESUME する", () => {
    // Arrange
    const client = createReadyClient();

    // Act
    const outputs = client.received(JSON.stringify({ op: GatewayOpcodes.InvalidSession, d: true }));

    // Assert
    expect(outputs).toEqual([
      { type: "disconnect", code: 4000 },
      { type: "reconnect", at: now + 3000, url: `${resumeUrl}/?v=10&encoding=json`, resume: true },
    ]);
  });

  test("d が false なら、session を捨て、待った後に gateway URL で IDENTIFY する", () => {
    // Arrange
    const client = createReadyClient();

    // Act
    const outputs = client.received(
      JSON.stringify({ op: GatewayOpcodes.InvalidSession, d: false }),
    );

    // Assert
    expect(outputs).toEqual([
      { type: "disconnect", code: 4000 },
      {
        type: "reconnect",
        at: now + 3000,
        url: `${gatewayUrl}/?v=10&encoding=json`,
        resume: false,
      },
    ]);
    expect(client.state).toEqual(freshState);
  });
});

describe("接続が切れる", () => {
  test.each([
    [4004, "AuthenticationFailed"],
    [4010, "InvalidShard"],
    [4011, "ShardingRequired"],
    [4012, "InvalidAPIVersion"],
    [4013, "InvalidIntents"],
    [4014, "DisallowedIntents"],
  ])("close code %i では停止する", (code, name) => {
    // Arrange
    const client = createReadyClient();

    // Act
    const outputs = client.disconnected(code);

    // Assert
    expect(outputs).toEqual([{ type: "stop", reason: `${name} (${code})` }]);
  });

  test.each([4007, 4009])("close code %i では、backoff の後に新しい session を始める", (code) => {
    // Arrange
    const client = createReadyClient();

    // Act
    const outputs = client.disconnected(code);

    // Assert
    expect(outputs).toEqual([
      { type: "reconnect", at: now + 750, url: `${gatewayUrl}/?v=10&encoding=json`, resume: false },
    ]);
  });

  test.each([1000, 1006, 4000, 4001, 4002, 4003, 4005, 4008])(
    "close code %i では、backoff の後に RESUME する",
    (code) => {
      // Arrange
      const client = createReadyClient();

      // Act
      const outputs = client.disconnected(code);

      // Assert
      expect(outputs).toEqual([
        { type: "reconnect", at: now + 750, url: `${resumeUrl}/?v=10&encoding=json`, resume: true },
      ]);
    },
  );

  test("READY の前に接続が切れたら IDENTIFY する", () => {
    // Arrange
    const client = createClient({ state: freshState });
    client.start();
    client.connected();
    client.received(hello);

    // Act
    const outputs = client.disconnected(1006);

    // Assert
    expect(outputs).toEqual([
      { type: "reconnect", at: now + 750, url: `${gatewayUrl}/?v=10&encoding=json`, resume: false },
    ]);
  });

  test("最初の socket が開く前に失敗したら、やり直す", () => {
    // Arrange
    const client = createClient({ state: freshState });
    client.start();

    // Act
    const outputs = client.disconnected(1006);

    // Assert
    expect(outputs).toEqual([
      { type: "reconnect", at: now + 750, url: `${gatewayUrl}/?v=10&encoding=json`, resume: false },
    ]);
  });

  test("op 7 で開いた socket が開く前に失敗したら、RESUME をやり直す", () => {
    // Arrange
    const client = createReadyClient();
    client.received(JSON.stringify({ op: GatewayOpcodes.Reconnect, d: null }));

    // Act
    const outputs = client.disconnected(1006);

    // Assert
    expect(outputs).toEqual([
      { type: "reconnect", at: now + 750, url: `${resumeUrl}/?v=10&encoding=json`, resume: true },
    ]);
  });

  test("停止した後の close は無視する", () => {
    // Arrange
    const client = createReadyClient();
    client.disconnected(4004);

    // Act
    const outputs = client.disconnected(1006);

    // Assert
    expect(outputs).toEqual([]);
  });
});

describe("再接続の backoff", () => {
  test("失敗ごとに待ち時間を 5 分まで倍にし、間隔の 1/2〜1 に散らす", () => {
    // Arrange
    const client = createClient({ state: freshState });
    client.start();

    // Act
    const waits = Array.from({ length: 11 }, () => {
      const [output] = client.disconnected(1006);
      return output?.type === "reconnect" ? output.at - now : null;
    });

    // Assert
    expect(waits).toEqual([
      750, 1500, 3000, 6000, 12_000, 24_000, 48_000, 96_000, 192_000, 225_000, 225_000,
    ]);
  });

  test("READY の後は 1 秒に戻る", () => {
    // Arrange
    const client = createClient({ state: freshState });
    client.start();
    client.disconnected(1006);
    client.disconnected(1006);
    client.connected();
    client.received(hello);
    client.received(ready);

    // Act
    const outputs = client.disconnected(1006);

    // Assert
    expect(outputs).toEqual([
      { type: "reconnect", at: now + 750, url: `${resumeUrl}/?v=10&encoding=json`, resume: true },
    ]);
  });

  test("RESUMED の後は 1 秒に戻る", () => {
    // Arrange
    const client = createClient({ state: resumableState });
    client.start();
    client.disconnected(1006);
    client.disconnected(1006);
    client.connected();
    client.received(hello);
    client.received(
      JSON.stringify({
        op: GatewayOpcodes.Dispatch,
        t: GatewayDispatchEvents.Resumed,
        s: 43,
        d: {},
      }),
    );

    // Act
    const outputs = client.disconnected(1006);

    // Assert
    expect(outputs).toEqual([
      { type: "reconnect", at: now + 750, url: `${resumeUrl}/?v=10&encoding=json`, resume: true },
    ]);
  });
});
