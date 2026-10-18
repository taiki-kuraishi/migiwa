import { TaggedError } from "better-result";

export class BotTokenReadError extends TaggedError("BotTokenReadError")<{
  cause: unknown;
  message: string;
}> {}
