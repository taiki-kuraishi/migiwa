import { deriveIntents } from "@migiwa/gateway";
import { Result } from "better-result";

import type { DiscordClient } from "../client/discord-client";
import type { GatewayStateRepository } from "../repository/gateway-state-repository";

/**
 * Gateway に繋ぐ前に、IDENTIFY の intents と接続に使う状態を揃える。
 */
export class PrepareGatewayUseCase {
  private readonly discord: DiscordClient;
  private readonly gatewayStates: GatewayStateRepository;

  /**
   * Discord の REST client と Gateway の状態の repository を受け取る。
   */
  public constructor(args: { discord: DiscordClient; gatewayStates: GatewayStateRepository }) {
    this.discord = args.discord;
    this.gatewayStates = args.gatewayStates;
  }

  /**
   * Intents と、保存した session に今の gateway URL を合わせた状態を返す。
   * 1. Application の flags を取る
   * 2. 今の gateway URL を取る
   * 3. 保存した状態を読む
   * 4. 保存した状態が無ければ、session の無い状態で始める
   * 5. 保存した session を残し、gateway URL だけを今のものにして返す
   */
  public async execute() {
    return Result.gen(async function* () {
      // Step 1: Application の flags を取る
      const application = yield* await this.discord.getCurrentApplication();

      // Step 2: 今の gateway URL を取る
      const gateway = yield* await this.discord.getGatewayBot();

      // Step 3: 保存した状態を読む
      const stored = yield* this.gatewayStates.find();

      // Step 4: 保存した状態が無ければ、session の無い状態で始める
      if (stored === undefined) {
        return Result.ok({
          intents: deriveIntents(application.flags),
          state: { sessionId: null, sequence: null, resumeUrl: null, gatewayUrl: gateway.url },
        });
      }

      // Step 5: 保存した session を残し、gateway URL だけを今のものにして返す
      return Result.ok({
        intents: deriveIntents(application.flags),
        state: { ...stored, gatewayUrl: gateway.url },
      });
    }, this);
  }
}
