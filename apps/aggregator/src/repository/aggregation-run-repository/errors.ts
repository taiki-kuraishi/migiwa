import { TaggedError } from "better-result";

export class AggregationRunQueryError extends TaggedError("AggregationRunQueryError")<{
  cause: unknown;
  message: string;
}> {}
