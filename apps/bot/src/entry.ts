import { botStub } from "./bot-stub";
import { app } from "./server";

export { BotObject } from "./bot-object";

export default {
  fetch: app.fetch,
  // The outer watchdog (spec §4): a minute cron that re-enters the DO if its alarm chain broke.
  async scheduled(_controller, env, _ctx) {
    await botStub(env).ensureConnected();
  },
} satisfies ExportedHandler<Cloudflare.Env>;
