import { DurableObject } from "cloudflare:workers";

// Fake Discord for apps/bot's tests: the REST endpoint GET /gateway/bot plus a scriptable
// Gateway WebSocket. A Durable Object, not a stateless Worker (wave 9): reconnect.spec.ts needs
// Server-initiated frames (op 7, op 9) and closes with a chosen code, and only an object that
// Persists across requests can touch a WebSocket a previous request accepted (see the comment on
// Send() below). Miniflare keeps one isolate for this Worker for the whole test run and routes
// Every request to the same "gateway" instance, so its fields behave like the old module-level
// State did; the tests reset them between cases.
//
// What this mock accepts that the real Discord would reject (.claude/rules/rebuild.md "Mocks
// That accept too much"): no Authorization check on GET /gateway/bot; no check of the upgrade
// Request's `?v=10&encoding=json`; no fatal close code unless a test sets closeAfterIdentify;
// READY with zero RTT unless a test sets readyDelayMs; and RESUME accepted whenever
// `options.resumable` is true. The mock only flips that to false automatically after a close
// With code 1000 or 1001 (mirroring real Discord's own rule) — after any other code that should
// Also forbid RESUME (a fatal code, an IDENTIFY-only code like 4009), `resumable` stays true
// Unless a test sets it itself, so nothing here catches a RESUME wrongly sent after one of those.

const DEFAULTS = {
  heartbeatInterval: 41_250,
  ackHeartbeats: true,
  sessionId: "sess-1",
  resumeGatewayUrl: "wss://gateway-resume.discord.gg",
  gatewayBotStatus: 200,
  remaining: 999,
  // 0 sends READY synchronously with IDENTIFY, hiding races a real handshake's RTT exposes.
  readyDelayMs: 0,
  // A close code to send instead of READY, simulating a fatal close right after IDENTIFY.
  closeAfterIdentify: null,
  // Gates op 6 RESUME (see the file header); real Discord decides this from the preceding close
  // Code, this mock is told directly through /options or flips it itself after 1000/1001.
  resumable: true,
};

export class MockGateway extends DurableObject {
  options = { ...DEFAULTS };
  server = null; // Server side of the current socket.
  received = []; // Frames the bot sent over the current socket.
  connections = 0; // How many times openGateway() has accepted a socket since the last /reset.

  send(frame) {
    this.server?.send(JSON.stringify(frame));
  }

  readyPayload() {
    return {
      op: 0,
      s: 1,
      t: "READY",
      d: {
        v: 10,
        user: { id: "bot-1" },
        session_id: this.options.sessionId,
        resume_gateway_url: this.options.resumeGatewayUrl,
        guilds: [],
      },
    };
  }

  openGateway() {
    const pair = new WebSocketPair(),
      [client, socket] = Object.values(pair);
    this.connections += 1;
    socket.accept();
    this.server = socket;
    this.received = [];
    socket.addEventListener("message", (event) => this.onSocketMessage(event));
    socket.addEventListener("close", (event) => this.onSocketClose(socket, event));
    this.send({
      op: 10,
      s: null,
      t: null,
      d: { heartbeat_interval: this.options.heartbeatInterval },
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  // Split out of openGateway() to stay under the statement-count limit.
  onSocketMessage(event) {
    const frame = JSON.parse(event.data);
    this.received.push(frame);
    if (frame.op === 2) {
      this.onIdentifyFrame();
    } else if (frame.op === 6) {
      this.onResumeFrame(frame);
    } else if (frame.op === 1 && this.options.ackHeartbeats) {
      this.send({ op: 11, s: null, t: null, d: null });
    }
  }

  // Split out of onSocketMessage() to stay under the statement-count limit.
  onIdentifyFrame() {
    if (this.options.closeAfterIdentify !== null) {
      this.server?.close(this.options.closeAfterIdentify);
    } else if (this.options.readyDelayMs > 0) {
      setTimeout(() => this.send(this.readyPayload()), this.options.readyDelayMs);
    } else {
      this.send(this.readyPayload());
    }
  }

  // Split out of onSocketMessage() to stay under the statement-count limit.
  onResumeFrame(frame) {
    if (this.options.resumable) {
      this.send({ op: 0, s: frame.d.seq + 1, t: "RESUMED", d: {} });
    } else {
      this.send({ op: 9, s: null, t: null, d: false });
    }
  }

  // Split out of openGateway() to stay under the statement-count limit.
  onSocketClose(socket, event) {
    if (this.server === socket) {
      this.server = null;
    }
    // Real Discord discards the session after a close it reads as 1000/1001 ("client is
    // Done"), so the RESUME that follows fails with op 9 (`d: false`). Mirrored here so
    // Bot-object.ts's dropSocket() (which must never use these codes ahead of a RESUME) has a
    // Regression test instead of only the 24-hour soak.
    if (event.code === 1000 || event.code === 1001) {
      this.options.resumable = false;
    }
  }

  resetMock() {
    // The object persists for the whole test run (see the file header), so a leftover socket
    // From the previous test must be closed here, unlike the old stateless mock, which could
    // Never reach a socket accepted by an earlier request in the first place.
    this.server?.close();
    this.server = null;
    this.received = [];
    this.connections = 0;
    this.options = { ...DEFAULTS };
    return new Response(null, { status: 204 });
  }

  gatewayBotResponse() {
    if (this.options.gatewayBotStatus !== 200) {
      return new Response("nope", { status: this.options.gatewayBotStatus });
    }
    return Response.json({
      url: "wss://gateway.discord.gg",
      shards: 1,
      session_start_limit: {
        total: 1000,
        remaining: this.options.remaining,
        reset_after: 3_600_000,
        max_concurrency: 1,
      },
    });
  }

  async control(url, request) {
    switch (url.pathname) {
      case "/received": {
        return Response.json(this.received);
      }
      case "/connections": {
        return Response.json(this.connections);
      }
      case "/options": {
        this.options = { ...this.options, ...(await request.json()) };
        return new Response(null, { status: 204 });
      }
      case "/send": {
        return this.handleSend(request);
      }
      case "/close": {
        return this.handleClose(request);
      }
      case "/reset": {
        return this.resetMock();
      }
      default: {
        return new Response("unknown control path", { status: 404 });
      }
    }
  }

  // Split out of control() to stay under the statement-count limit.
  async handleSend(request) {
    if (this.server === null) {
      return new Response("/send: no open socket", { status: 409 });
    }
    this.send(await request.json());
    return new Response(null, { status: 204 });
  }

  // Split out of control() to stay under the statement-count limit.
  async handleClose(request) {
    if (this.server === null) {
      return new Response("/close: no open socket", { status: 409 });
    }
    const { code, reason } = await request.json();
    this.server.close(code, reason);
    return new Response(null, { status: 204 });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.host === "discord.com" && url.pathname === "/api/v10/gateway/bot") {
      return this.gatewayBotResponse();
    }
    if (url.host.endsWith(".discord.gg")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected a websocket upgrade", { status: 426 });
      }
      return this.openGateway();
    }
    if (url.host === "mock") {
      return this.control(url, request);
    }
    return new Response(`not mocked: ${request.url}`, { status: 502 });
  }
}

export default {
  // Every request this Worker gets — the gateway upgrade, GET /gateway/bot, and the mock's own
  // Control plane — is routed to the single "gateway" instance, so all of it shares one view of
  // `options`/`server`/`received` (see the file header for why that must be a Durable Object).
  fetch(request, env) {
    return env.GATEWAY.get(env.GATEWAY.idFromName("gateway")).fetch(request);
  },
};
