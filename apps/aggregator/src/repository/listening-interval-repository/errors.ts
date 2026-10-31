import { TaggedError } from "better-result";

export class ListeningIntervalQueryError extends TaggedError("ListeningIntervalQueryError")<{
  cause: unknown;
  message: string;
}> {}
