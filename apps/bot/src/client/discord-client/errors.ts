import { TaggedError } from "better-result";

export class DiscordRequestError extends TaggedError("DiscordRequestError")<{
  cause: unknown;
  message: string;
}> {}

export class DiscordResponseError extends TaggedError("DiscordResponseError")<{
  status: number;
  message: string;
}> {}
