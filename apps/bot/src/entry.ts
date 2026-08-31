export { BotObject } from "./bot-object";

export default {
  async fetch() {
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Cloudflare.Env>;
