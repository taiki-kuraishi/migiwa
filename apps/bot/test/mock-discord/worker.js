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
// READY with zero RTT unless a test sets readyDelayMs (RESUMED likewise, via resumedDelayMs);
// And RESUME accepted whenever `options.resumable` is true. The mock only flips that to false
// Automatically after a close with code 1000 or 1001 (mirroring real Discord's own rule) —
// After any other code that should
// Also forbid RESUME (a fatal code, an IDENTIFY-only code like 4009), `resumable` stays true
// Unless a test sets it itself, so nothing here catches a RESUME wrongly sent after one of those.
// (a) IDENTIFY's `token` / `intents` / `properties` are never checked — real Discord answers
// 4004 / 4013 / 4014 for those. Partly compensated: gateway.spec.ts asserts the IDENTIFY payload
// Itself, so a wrong `intents` still fails a test, just not through a close code.
// (b) RESUME's `token` / `session_id` / `seq` are never checked, and no dispatch is replayed from
// `seq` — real Discord answers op 9 for an unknown session or a bad seq. Nothing in this suite
// Verifies spec §5.1 / §6.4's "resume from the last committed seq without applying an event
// Twice"; only the 24-hour soak exercises real replay.
// (c) The gateway host (`gateway.discord.gg`) and the resume host (`gateway-resume.discord.gg`)
// Share one handler, so nothing here would refuse a RESUME dialled at the wrong host — the
// Bot's own choice of host is constrained instead, from the client side, via hosts() below.
// (d) The mock never requires heartbeats on its own account and never closes a socket for a
// Missing one; only isZombie() on the bot's side ever ends a connection over a missed ACK.

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
  // 0 sends RESUMED synchronously with RESUME, same tradeoff as readyDelayMs above.
  resumedDelayMs: 0,
};

export class MockGateway extends DurableObject {
  options = { ...DEFAULTS };
  server = null; // Server side of the current socket.
  received = []; // Frames the bot sent over the current socket.
  connections = 0; // How many times openGateway() has accepted a socket since the last /reset.
  hosts = []; // The host each openGateway() call upgraded, in order, since the last /reset.
  closeCodes = []; // Close codes the server-side socket has observed, in order, since /reset.

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

  // Message/close listeners are inlined here rather than split into their own methods: an
  // AddEventListener callback is its own function scope with its own statement budget, so
  // Splitting them out bought nothing against openGateway()'s own limit. onIdentifyFrame() below
  // Stays split out because its own body alone is long enough to need the room.
  openGateway(host) {
    const pair = new WebSocketPair(),
      [client, socket] = Object.values(pair);
    this.connections += 1;
    this.hosts.push(host);
    socket.accept();
    this.server = socket;
    this.received = [];
    socket.addEventListener("message", (event) => {
      const frame = JSON.parse(event.data);
      this.received.push(frame);
      if (frame.op === 2) {
        this.onIdentifyFrame();
      } else if (frame.op === 6 && !this.options.resumable) {
        this.send({ op: 9, s: null, t: null, d: false });
      } else if (frame.op === 6) {
        const resumed = { op: 0, s: frame.d.seq + 1, t: "RESUMED", d: {} };
        if (this.options.resumedDelayMs > 0) {
          setTimeout(() => this.send(resumed), this.options.resumedDelayMs);
        } else {
          this.send(resumed);
        }
      } else if (frame.op === 1 && this.options.ackHeartbeats) {
        this.send({ op: 11, s: null, t: null, d: null });
      }
    });
    socket.addEventListener("close", (event) => {
      this.closeCodes.push(event.code);
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
    });
    this.send({
      op: 10,
      s: null,
      t: null,
      d: { heartbeat_interval: this.options.heartbeatInterval },
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  // Kept split out (unlike the message/close listeners above): its own body already needs the
  // Full statement budget.
  onIdentifyFrame() {
    if (this.options.closeAfterIdentify !== null) {
      this.server?.close(this.options.closeAfterIdentify);
    } else if (this.options.readyDelayMs > 0) {
      setTimeout(() => this.send(this.readyPayload()), this.options.readyDelayMs);
    } else {
      this.send(this.readyPayload());
    }
  }

  resetMock() {
    // Not closing `server` here: every caller (BotObject's own dropSocket()/close reach-in, or
    // A Discord-initiated close via /close) already closes its end before or instead of calling
    // /reset, and a WebSocketPair's close propagates to the other side — calling close() again
    // On an already-closing socket throws "already closed by the other side". Nulling the
    // Reference is enough; the close listener above does the same once that event lands.
    this.server = null;
    this.received = [];
    this.connections = 0;
    this.hosts = [];
    this.closeCodes = [];
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
      // One path for both new wave-9 accessors: a case each would push control() over the
      // Statement-count limit (unicorn/switch-case-braces counts every case body against it).
      case "/mock-state": {
        return Response.json({ hosts: this.hosts, closeCodes: this.closeCodes });
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
      return this.openGateway(url.host);
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
