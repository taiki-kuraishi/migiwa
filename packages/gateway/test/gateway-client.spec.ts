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

describe("start", () => {
  test("connects to the gateway URL to identify when no session is stored", () => {
    // Arrange
    const client = createClient({ state: freshState });

    // Act
    const outputs = client.start();

    // Assert
    expect(outputs).toEqual([
      { type: "reconnect", at: now, url: `${gatewayUrl}/?v=10&encoding=json`, resume: false },
    ]);
  });

  test("connects to the resume URL to resume when a session is stored", () => {
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

describe("HELLO", () => {
  test("sends IDENTIFY and schedules the first heartbeat after a jittered interval", () => {
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

  test("sends RESUME with the stored session and sequence", () => {
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

describe("dispatch", () => {
  test("READY stores the session ID, sequence and resume URL", () => {
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

  test("passes later events on with the session ID and advances the sequence", () => {
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

describe("heartbeat", () => {
  test("sends the last sequence and schedules the next one when the previous was acknowledged", () => {
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

  test("closes with a resumable code and resumes when the previous heartbeat got no ACK", () => {
    // Arrange
    const client = createReadyClient();
    client.heartbeatDue();

    // Act
    const outputs = client.heartbeatDue();

    // Assert
    expect(outputs).toEqual([
      { type: "disconnect", code: 4000 },
      { type: "reconnect", at: now, url: `${resumeUrl}/?v=10&encoding=json`, resume: true },
    ]);
  });

  test("keeps the connection when the ACK arrived before the next heartbeat", () => {
    // Arrange
    const client = createReadyClient();
    client.heartbeatDue();
    client.received(JSON.stringify({ op: GatewayOpcodes.HeartbeatAck }));

    // Act
    const outputs = client.heartbeatDue();

    // Assert
    expect(outputs[0]).toEqual({ type: "send", payload: { op: GatewayOpcodes.Heartbeat, d: 2 } });
  });

  test("answers a heartbeat request immediately", () => {
    // Arrange
    const client = createReadyClient();

    // Act
    const outputs = client.received(JSON.stringify({ op: GatewayOpcodes.Heartbeat, d: null }));

    // Assert
    expect(outputs).toEqual([{ type: "send", payload: { op: GatewayOpcodes.Heartbeat, d: 2 } }]);
  });
});

describe("received", () => {
  test.each(["not json", "null", "42", '{"d":null}', '{"op":"10"}'])(
    "closes with a resumable code and resumes on a frame that is not a payload: %s",
    (text) => {
      // Arrange
      const client = createReadyClient();

      // Act
      const outputs = client.received(text);

      // Assert
      expect(outputs).toEqual([
        { type: "disconnect", code: 4000 },
        { type: "reconnect", at: now, url: `${resumeUrl}/?v=10&encoding=json`, resume: true },
      ]);
    },
  );

  test("ignores frames and heartbeats before the socket opens", () => {
    // Arrange
    const client = createClient({ state: freshState });
    client.start();

    // Act
    const outputs = [...client.received(hello), ...client.heartbeatDue()];

    // Assert
    expect(outputs).toEqual([]);
  });
});

describe("op 7 reconnect", () => {
  test("closes with a resumable code and resumes on the resume URL", () => {
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

describe("op 9 invalid session", () => {
  test("resumes after the 1-5 second wait when d is true", () => {
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

  test("drops the session and identifies on the gateway URL after the wait when d is false", () => {
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

describe("disconnected", () => {
  test.each([
    [4004, "AuthenticationFailed"],
    [4010, "InvalidShard"],
    [4011, "ShardingRequired"],
    [4012, "InvalidAPIVersion"],
    [4013, "InvalidIntents"],
    [4014, "DisallowedIntents"],
  ])("stops on close code %i", (code, name) => {
    // Arrange
    const client = createReadyClient();

    // Act
    const outputs = client.disconnected(code);

    // Assert
    expect(outputs).toEqual([{ type: "stop", reason: `${name} (${code})` }]);
  });

  test.each([4007, 4009])("starts a new session on close code %i", (code) => {
    // Arrange
    const client = createReadyClient();

    // Act
    const outputs = client.disconnected(code);

    // Assert
    expect(outputs).toEqual([
      { type: "reconnect", at: now, url: `${gatewayUrl}/?v=10&encoding=json`, resume: false },
    ]);
  });

  test.each([1000, 1006, 4000, 4001, 4002, 4003, 4005, 4008])(
    "resumes on close code %i",
    (code) => {
      // Arrange
      const client = createReadyClient();

      // Act
      const outputs = client.disconnected(code);

      // Assert
      expect(outputs).toEqual([
        { type: "reconnect", at: now, url: `${resumeUrl}/?v=10&encoding=json`, resume: true },
      ]);
    },
  );

  test("identifies when the connection drops before READY", () => {
    // Arrange
    const client = createClient({ state: freshState });
    client.start();
    client.connected();
    client.received(hello);

    // Act
    const outputs = client.disconnected(1006);

    // Assert
    expect(outputs).toEqual([
      { type: "reconnect", at: now, url: `${gatewayUrl}/?v=10&encoding=json`, resume: false },
    ]);
  });

  test("retries when the first socket fails before it opens", () => {
    // Arrange
    const client = createClient({ state: freshState });
    client.start();

    // Act
    const outputs = client.disconnected(1006);

    // Assert
    expect(outputs).toEqual([
      { type: "reconnect", at: now, url: `${gatewayUrl}/?v=10&encoding=json`, resume: false },
    ]);
  });

  test("retries the resume when the socket opened for op 7 fails before it opens", () => {
    // Arrange
    const client = createReadyClient();
    client.received(JSON.stringify({ op: GatewayOpcodes.Reconnect, d: null }));

    // Act
    const outputs = client.disconnected(1006);

    // Assert
    expect(outputs).toEqual([
      { type: "reconnect", at: now, url: `${resumeUrl}/?v=10&encoding=json`, resume: true },
    ]);
  });

  test("ignores a close after it stopped", () => {
    // Arrange
    const client = createReadyClient();
    client.disconnected(4004);

    // Act
    const outputs = client.disconnected(1006);

    // Assert
    expect(outputs).toEqual([]);
  });
});
