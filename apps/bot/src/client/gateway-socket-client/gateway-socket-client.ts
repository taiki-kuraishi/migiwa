import { Result } from "better-result";

import { connectTimeout } from "./constants";
import { GatewayConnectError, GatewayUpgradeError } from "./errors";

/**
 * Discord Gateway への WebSocket を開く。
 */
export class GatewaySocketClient {
  /**
   * Gateway の URL へ Upgrade の request を送り、受け入れた socket を返す。
   * 1. wss の URL を fetch が受け付ける https に変えて Upgrade を送る。届かなければ
   *    GatewayConnectError を返す
   * 2. Upgrade が通らなければ GatewayUpgradeError を返す
   * 3. Socket を受け入れて返す
   */
  public async open(url: string) {
    return Result.gen(async function* () {
      // Step 1: wss の URL を fetch が受け付ける https に変えて Upgrade を送る。届かなければ
      // GatewayConnectError を返す
      const httpsUrl = new URL(url);
      httpsUrl.protocol = "https:";
      // WebSocket の constructor は permessage-deflate を付けて handshake するので、fetch で開く。
      // 待つ時間は AbortSignal で切らない。signal は応答の後も生きていて、開いた socket まで巻き込みうる。
      const response = yield* await Result.tryPromise({
        try: async () =>
          Promise.race([fetch(httpsUrl, { headers: { Upgrade: "websocket" } }), this.timeout()]),
        catch: (cause) =>
          new GatewayConnectError({ cause, message: `Upgrade to ${httpsUrl.host} failed` }),
      });

      // Step 2: Upgrade が通らなければ GatewayUpgradeError を返す
      if (response.webSocket === null) {
        return Result.err(
          new GatewayUpgradeError({
            status: response.status,
            message: `${httpsUrl.host} answered the upgrade with ${response.status}`,
          }),
        );
      }

      // Step 3: Socket を受け入れて返す
      response.webSocket.accept();
      return Result.ok(response.webSocket);
    }, this);
  }

  /**
   * Upgrade の応答を待つ上限の connectTimeout が過ぎたら reject する。
   */
  // 必ず throw するので never を書く。導出に任せると void になり、race の結果に混ざる。
  private async timeout(): Promise<never> {
    await scheduler.wait(connectTimeout);
    throw new Error(`No upgrade response within ${connectTimeout} ms`);
  }
}
