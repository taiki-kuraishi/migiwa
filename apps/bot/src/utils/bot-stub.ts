/**
 * Bot は 1 つなので、Gateway に繋ぐ Durable Object も 1 つだけ使う。
 */
export const botStub = (env: Cloudflare.Env) => env.BOT.get(env.BOT.idFromName("default"));
