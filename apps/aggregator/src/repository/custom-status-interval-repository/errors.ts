import { TaggedError } from "better-result";

export class CustomStatusIntervalQueryError extends TaggedError("CustomStatusIntervalQueryError")<{
  cause: unknown;
  message: string;
}> {}
