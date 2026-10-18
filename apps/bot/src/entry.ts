import { app } from "./server";
import { botStub } from "./utils/bot-stub";

export { BotObject } from "./bot-object";

export default {
  fetch: app.fetch,
  scheduled: async (_controller, env) => {
    await botStub(env).ensureConnected();
  },
} satisfies ExportedHandler<Cloudflare.Env>;
