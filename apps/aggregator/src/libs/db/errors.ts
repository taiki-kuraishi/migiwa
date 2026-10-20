import { TaggedError } from "better-result";

export class DbTransactionError extends TaggedError("DbTransactionError")<{
  cause: unknown;
  message: string;
}> {}
