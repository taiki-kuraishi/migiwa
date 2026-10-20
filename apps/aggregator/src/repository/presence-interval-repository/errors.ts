import { TaggedError } from "better-result";

export class PresenceIntervalQueryError extends TaggedError("PresenceIntervalQueryError")<{
  cause: unknown;
  message: string;
}> {}
