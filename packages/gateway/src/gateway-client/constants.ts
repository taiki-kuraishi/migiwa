import { GatewayCloseCodes } from "discord-api-types/v10";

// 1000/1001 以外の code で閉じれば Discord 側で session が生き続け、RESUME できる。
export const resumableCloseCode = 4000;

export const stopCloseCodes = new Set<number>([
  GatewayCloseCodes.AuthenticationFailed,
  GatewayCloseCodes.InvalidShard,
  GatewayCloseCodes.ShardingRequired,
  GatewayCloseCodes.InvalidAPIVersion,
  GatewayCloseCodes.InvalidIntents,
  GatewayCloseCodes.DisallowedIntents,
]);

export const newSessionCloseCodes = new Set<number>([
  GatewayCloseCodes.InvalidSeq,
  GatewayCloseCodes.SessionTimedOut,
]);
