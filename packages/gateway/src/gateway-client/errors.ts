import { TaggedError } from "better-result";

export class GatewayPayloadParseError extends TaggedError("GatewayPayloadParseError")<{
  cause: unknown;
  message: string;
}> {}
