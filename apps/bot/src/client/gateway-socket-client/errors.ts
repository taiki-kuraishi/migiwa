import { TaggedError } from "better-result";

export class GatewayConnectError extends TaggedError("GatewayConnectError")<{
  cause: unknown;
  message: string;
}> {}

export class GatewayUpgradeError extends TaggedError("GatewayUpgradeError")<{
  status: number;
  message: string;
}> {}
