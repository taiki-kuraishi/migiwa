import { DurableObject } from "cloudflare:workers";

// Stand-in for apps/bot's BotObject with the RPC surface of @migiwa/gateway's BotRpc.
// Tests steer it through setState(); nothing here talks to Discord.
export class BotObject extends DurableObject {
  async setState(state) {
    this.ctx.storage.kv.put("state", state);
  }

  async status() {
    return {
      state: this.ctx.storage.kv.get("state") ?? "stopped",
      since: 0,
      reason: null,
      last_event_at: null,
      seq: null,
      guild_count: 0,
      reconnects_24h: 0,
      identify_remaining: null,
    };
  }

  async ensureConnected() {
    return this.status();
  }
}

export default { fetch: () => new Response("fake migiwa-bot", { status: 404 }) };
