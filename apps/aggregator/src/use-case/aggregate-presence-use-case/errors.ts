import { TaggedError } from "better-result";

export class AggregationRunConflictError extends TaggedError("AggregationRunConflictError")<{
  message: string;
}> {}
