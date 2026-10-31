import { aggregate } from "./scheduled";

export default {
  scheduled: async (controller, env) => {
    await aggregate({ env, now: new Date(controller.scheduledTime) });
  },
} satisfies ExportedHandler<Cloudflare.Env>;
