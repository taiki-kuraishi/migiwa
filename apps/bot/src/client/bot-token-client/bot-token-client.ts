import { Result } from "better-result";

import { BotTokenReadError } from "./errors";

/**
 * Secrets Store から Discord の bot token を読む。
 */
export class BotTokenClient {
  private readonly secret: SecretsStoreSecret;

  /**
   * Bot token の Secrets Store binding を受け取る。
   */
  public constructor(args: { secret: SecretsStoreSecret }) {
    this.secret = args.secret;
  }

  /**
   * Bot token を読む。読めなければ BotTokenReadError を返す。
   */
  public async get() {
    return Result.tryPromise({
      try: async () => this.secret.get(),
      catch: (cause) =>
        new BotTokenReadError({
          cause,
          message: "Failed to read the bot token from Secrets Store",
        }),
    });
  }
}
