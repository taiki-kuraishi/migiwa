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
  // (the accepting request here is the gateway upgrade fetch() in openGateway() below). This
  // Function is only ever called from openGateway()'s own message listener, which runs inside
  // That same accepting request's context, so it never hits that restriction — unlike a
  // Control-plane call (see /send and /close below, which refuse instead of trying).
  send = (frame) => server?.send(JSON.stringify(frame));

let options = { ...DEFAULTS },
  server = null, // Server side of the current socket.
  received = [], // Frames the bot sent over the current socket.
  connections = 0; // How many times openGateway() has accepted a socket since the last /reset.

function openGateway() {
  const pair = new WebSocketPair(),
    [client, socket] = Object.values(pair);
  connections += 1;
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

function resetMock() {
  // Not closing `server` here: a stateless Worker cannot close a WebSocket accepted during a
  // Different request (see the comment on send() above), so this control call has no way to do
  // It. The socket is the caller's to close first — gateway.spec.ts's afterEach does that
  // DO-side, before it calls /reset.
  server = null;
  received = [];
  connections = 0;
  options = { ...DEFAULTS };
  return new Response(null, { status: 204 });
}

async function control(url, request) {
  switch (url.pathname) {
    case "/received": {
      return Response.json(received);
    }
    case "/connections": {
      return Response.json(connections);
    }
    case "/options": {
      options = { ...options, ...(await request.json()) };
      return new Response(null, { status: 204 });
    }
    case "/send":
    case "/close": {
      // A stateless Worker cannot touch a WebSocket accepted during a different request (see
      // The comment on send() above), so this endpoint cannot push a frame or simulate a
      // Discord-initiated close — it would need the mock to become a Durable Object (so this
      // Call ran in the same persistent context openGateway() did), or the frame to be
      // Scripted from inside openGateway()'s own message listener instead. Failing loudly here
      // Beats a 204 that quietly did nothing, which is what wave 9's server-pushed op 7 / op 9
      // Tests would otherwise time out chasing.
      return new Response(`${url.pathname} cannot act on a socket from a separate request`, {
        status: 501,
      });
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
