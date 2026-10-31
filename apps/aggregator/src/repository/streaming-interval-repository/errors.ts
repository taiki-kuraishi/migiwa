import { TaggedError } from "better-result";

export class StreamingIntervalQueryError extends TaggedError("StreamingIntervalQueryError")<{
  cause: unknown;
  message: string;
}> {}
