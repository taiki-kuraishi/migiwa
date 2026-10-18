import { TaggedError } from "better-result";

export class GatewayStateStorageError extends TaggedError("GatewayStateStorageError")<{
  cause: unknown;
  message: string;
}> {}
