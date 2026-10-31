import { TaggedError } from "better-result";

export class GameIntervalQueryError extends TaggedError("GameIntervalQueryError")<{
  cause: unknown;
  message: string;
}> {}
