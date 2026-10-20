import { aggregatePresence } from "./scheduled";

export default {
  scheduled: async (controller, env) => {
    await aggregatePresence({ env, now: new Date(controller.scheduledTime) });
  },
} satisfies ExportedHandler<Cloudflare.Env>;
