import { TaggedError } from "better-result";

export class BasinSqlRequestError extends TaggedError("BasinSqlRequestError")<{
  cause: unknown;
  message: string;
}> {}

export class BasinSqlResponseError extends TaggedError("BasinSqlResponseError")<{
  status: number;
  message: string;
}> {}
