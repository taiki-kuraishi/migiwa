import { Result } from "better-result";

import { SecretReadError } from "./errors";

/**
 * Secrets Store から 1 つの secret を読む。
 */
export class SecretClient {
  private readonly secret: SecretsStoreSecret;
  private readonly name: string;

  /**
   * Secret の Secrets Store binding と、ログに出す名前を受け取る。
   */
  public constructor(args: { secret: SecretsStoreSecret; name: string }) {
    this.secret = args.secret;
    this.name = args.name;
  }

  /**
   * Secret を読む。読めなければ SecretReadError を返す。
   */
  public async get() {
    return Result.tryPromise({
      try: async () => this.secret.get(),
      catch: (cause) =>
        new SecretReadError({
          cause,
          message: `Failed to read the ${this.name} from Secrets Store`,
        }),
    });
  }
}
