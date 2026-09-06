import type { GatewayBotSlice } from "@migiwa/gateway";

import { GATEWAY_BOT_ENDPOINT, validateGatewayBotInfo } from "@migiwa/gateway";
import { Result } from "better-result";

import { GatewayBotFailed, UpgradeFailed } from "./gateway-errors";
import { describeError } from "./log";

const USER_AGENT = "DiscordBot (https://github.com/taiki-kuraishi/migiwa, 1.0.0)";

// GET /gateway/bot: where to connect, how many shards Discord wants, and today's IDENTIFY
// Budget (spec §5.3). A 401 is the token being wrong; the caller treats it as fatal.
export async function fetchGatewayBot(
  token: string,
): Promise<Result<GatewayBotSlice, GatewayBotFailed>> {
  return Result.gen(async function* () {
    const response = yield* Result.await(
      Result.tryPromise({
        try: async () =>
          fetch(GATEWAY_BOT_ENDPOINT, {
            headers: { Authorization: `Bot ${token}`, "User-Agent": USER_AGENT },
          }),
        catch: (error) =>
          new GatewayBotFailed({
            status: null,
            message: `GET /gateway/bot unreachable: ${describeError(error)}`,
          }),
      }),
    );
    if (response.ok) {
      const json = yield* Result.await(
        Result.tryPromise({
          try: async (): Promise<unknown> => response.json(),
          catch: (error) =>
            new GatewayBotFailed({
              status: response.status,
              message: `GET /gateway/bot returned no JSON: ${describeError(error)}`,
            }),
        }),
      );
      // Typia checks the slice we read (spec D13); a shape change on Discord's side surfaces
      // Here as a backoff with the failing path in the log, not as a crash deeper in.
      return validateGatewayBotInfo(json).mapError(
        (error) => new GatewayBotFailed({ status: response.status, message: error.message }),
      );
    }
    return Result.err(
      new GatewayBotFailed({
        status: response.status,
        message: `GET /gateway/bot failed with ${response.status}`,
      }),
    );
  });
}

// Fetch() + Upgrade instead of `new WebSocket()`: the latter adds permessage-deflate, which
// Discord does not negotiate the way we want (spec §5.3). The socket comes back accepted;
// The caller attaches its listeners.
export async function openGatewaySocket(url: string): Promise<Result<WebSocket, UpgradeFailed>> {
  return Result.gen(async function* () {
    const response = yield* Result.await(
        Result.tryPromise({
          try: async () => fetch(url, { headers: { Upgrade: "websocket" } }),
          catch: (error) =>
            new UpgradeFailed({
              status: null,
              message: `gateway unreachable: ${describeError(error)}`,
            }),
        }),
      ),
      socket = response.webSocket;
    if (socket === null) {
      return Result.err(
        new UpgradeFailed({
          status: response.status,
          message: `gateway upgrade failed with ${response.status}`,
        }),
      );
    }
    socket.accept();
    return Result.ok(socket);
  });
}
