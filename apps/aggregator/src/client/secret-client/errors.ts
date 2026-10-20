import { TaggedError } from "better-result";

export class SecretReadError extends TaggedError("SecretReadError")<{
  cause: unknown;
  message: string;
}> {}
