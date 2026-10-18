import { DiscordAPIError, HTTPError, REST } from "@discordjs/rest";
import { Result } from "better-result";
import { Routes } from "discord-api-types/v10";

import { requestTimeout } from "./constants";
import { DiscordRequestError, DiscordResponseError } from "./errors";

/**
 * Discord の REST API を bot token で呼ぶ。rate limit の待ちと 429・5xx の再試行は @discordjs/rest に任せる。
 */
export class DiscordClient {
  private readonly rest: REST;

  /**
   * Bot token を受け取り、各 request の Authorization に使う。
   */
  public constructor(args: { token: string }) {
    this.rest = new REST({
      timeout: requestTimeout,
      // Durable Object が start のたびに作り直すので、片付けの timer は要らず、残すと積み重なる。
      hashSweepInterval: 0,
      handlerSweepInterval: 0,
    }).setToken(args.token);
  }

  /**
   * GET /applications/@me で application の flags を取る。
   * 1. Application を取る
   * 2. flags が数値でなければ DiscordResponseError を返す
   */
  public async getCurrentApplication() {
    return Result.gen(async function* () {
      // Step 1: Application を取る
      const body = yield* await this.get(Routes.currentApplication());

      // Step 2: flags が数値でなければ DiscordResponseError を返す
      const flags = this.field({ body, name: "flags" });

      if (typeof flags !== "number") {
        return Result.err(
          new DiscordResponseError({ status: 200, message: "GET /applications/@me has no flags" }),
        );
      }
      return Result.ok({ flags });
    }, this);
  }

  /**
   * GET /gateway/bot で接続先の gateway URL を取る。
   * 1. Gateway の情報を取る
   * 2. url が文字列でなければ DiscordResponseError を返す
   */
  public async getGatewayBot() {
    return Result.gen(async function* () {
      // Step 1: Gateway の情報を取る
      const body = yield* await this.get(Routes.gatewayBot());

      // Step 2: url が文字列でなければ DiscordResponseError を返す
      const url = this.field({ body, name: "url" });

      if (typeof url !== "string") {
        return Result.err(
          new DiscordResponseError({ status: 200, message: "GET /gateway/bot has no url" }),
        );
      }
      return Result.ok({ url });
    }, this);
  }

  /**
   * GET を送り、JSON の body を返す。Discord が失敗の status を返せば DiscordResponseError、届かなければ
   * DiscordRequestError を返す。
   */
  private async get(route: `/${string}`) {
    return Result.tryPromise({
      try: async (): Promise<unknown> => this.rest.get(route),
      catch: (cause) => {
        if (cause instanceof DiscordAPIError || cause instanceof HTTPError) {
          return new DiscordResponseError({
            status: cause.status,
            message: `GET ${route} returned ${cause.status}`,
          });
        }
        return new DiscordRequestError({ cause, message: `GET ${route} failed` });
      },
    });
  }

  /**
   * Body が object なら field の値を返す。型は呼び出し側が確かめる。
   * 1. Body が object でなければ undefined を返す
   * 2. Field の値を返す
   */
  private field(args: { body: unknown; name: string }) {
    // Step 1: Body が object でなければ undefined を返す
    if (typeof args.body !== "object" || args.body === null) {
      return undefined;
    }

    // Step 2: Field の値を返す
    const value: unknown = Reflect.get(args.body, args.name);
    return value;
  }
}
