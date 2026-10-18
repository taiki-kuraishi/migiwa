import type { GatewayState } from "@migiwa/gateway";

import { Result } from "better-result";

import { gatewayStateKey } from "./constants";
import { GatewayStateStorageError } from "./errors";

/**
 * Gateway の永続状態を Durable Object の KV storage に読み書きする。
 */
export class GatewayStateRepository {
  private readonly storage: SyncKvStorage;

  /**
   * Durable Object の同期 KV storage を受け取る。
   */
  public constructor(args: { storage: SyncKvStorage }) {
    this.storage = args.storage;
  }

  /**
   * 保存した状態を返す。まだ保存していなければ undefined を返す。
   */
  public find() {
    return Result.try({
      try: () => this.storage.get<GatewayState>(gatewayStateKey),
      catch: (cause) =>
        new GatewayStateStorageError({ cause, message: "Failed to read the gateway state" }),
    });
  }

  /**
   * 状態を上書きして保存する。
   */
  public save(state: GatewayState) {
    return Result.try({
      try: () => this.storage.put(gatewayStateKey, state),
      catch: (cause) =>
        new GatewayStateStorageError({ cause, message: "Failed to save the gateway state" }),
    });
  }
}
