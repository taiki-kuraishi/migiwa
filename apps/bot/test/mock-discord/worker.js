// Fake Discord for apps/bot's tests: the REST endpoint GET /gateway/bot plus a scriptable
// Gateway WebSocket. Module-level state is fine here: Miniflare keeps one isolate for this
// Worker for the whole test run and the tests reset it between cases.

const DEFAULTS = {
    heartbeatInterval: 41_250,
    ackHeartbeats: true,
    sessionId: "sess-1",
    resumeGatewayUrl: "wss://gateway-resume.discord.gg",
    gatewayBotStatus: 200,
    remaining: 999,
  },
  // Workers forbids touching a WebSocket from a request other than the one that accepted it
  // (the accepting request here is the gateway upgrade `fetch()` in openGateway() below). A
  // Control call like /send or /reset arrives as its own separate request, so a native call on
  // A stale `server` throws "Cannot perform I/O on behalf of a different request." The listener
  // Registered inside openGateway() calls this same function from the accepting request's own
  // Context, where it never throws; closeServer() below needs the identical guard for the same
  // Reason.
  send = (frame) => {
    try {
      server?.send(JSON.stringify(frame));
    } catch {
      // See the comment above `send`.
    }
  },
  closeServer = (code, reason) => {
    try {
      server?.close(code, reason);
    } catch {
      // See the comment above `send`.
    }
  };

let options = { ...DEFAULTS },
  server = null, // Server side of the current socket.
  received = []; // Frames the bot sent over the current socket.

function openGateway() {
  const pair = new WebSocketPair(),
    [client, socket] = Object.values(pair);
  socket.accept();
  server = socket;
  received = [];
  socket.addEventListener("message", (event) => {
    const frame = JSON.parse(event.data);
    received.push(frame);
    if (frame.op === 2) {
      send({
        op: 0,
        s: 1,
        t: "READY",
        d: {
          v: 10,
          user: { id: "bot-1" },
          session_id: options.sessionId,
          resume_gateway_url: options.resumeGatewayUrl,
          guilds: [],
        },
      });
    } else if (frame.op === 6) {
      send({ op: 0, s: frame.d.seq + 1, t: "RESUMED", d: {} });
    } else if (frame.op === 1 && options.ackHeartbeats) {
      send({ op: 11, s: null, t: null, d: null });
    }
  });
  socket.addEventListener("close", () => {
    if (server === socket) {
      server = null;
    }
  });
  send({ op: 10, s: null, t: null, d: { heartbeat_interval: options.heartbeatInterval } });
  return new Response(null, { status: 101, webSocket: client });
}

async function closeFromRequest(request) {
  const { code, reason } = await request.json();
  closeServer(code, reason);
  return new Response(null, { status: 204 });
}

function resetMock() {
  closeServer(1000, "reset");
  server = null;
  received = [];
  options = { ...DEFAULTS };
  return new Response(null, { status: 204 });
}

async function control(url, request) {
  switch (url.pathname) {
    case "/received": {
      return Response.json(received);
    }
    case "/options": {
      options = { ...options, ...(await request.json()) };
      return new Response(null, { status: 204 });
    }
    case "/send": {
      send(await request.json());
      return new Response(null, { status: 204 });
    }
    case "/close": {
      return closeFromRequest(request);
    }
    case "/reset": {
      return resetMock();
    }
    default: {
      return new Response("unknown control path", { status: 404 });
    }
  }
}

function gatewayBotResponse() {
  if (options.gatewayBotStatus !== 200) {
    return new Response("nope", { status: options.gatewayBotStatus });
  }
  return Response.json({
    url: "wss://gateway.discord.gg",
    shards: 1,
    session_start_limit: {
      total: 1000,
      remaining: options.remaining,
      reset_after: 3_600_000,
      max_concurrency: 1,
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.host === "discord.com" && url.pathname === "/api/v10/gateway/bot") {
      return gatewayBotResponse();
    }
    if (url.host.endsWith(".discord.gg")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected a websocket upgrade", { status: 426 });
      }
      return openGateway();
    }
    if (url.host === "mock") {
      return control(url, request);
    }
    return new Response(`not mocked: ${request.url}`, { status: 502 });
  },
};
