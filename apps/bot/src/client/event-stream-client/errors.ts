import { TaggedError } from "better-result";

export class EventRecordInvalidError extends TaggedError("EventRecordInvalidError")<{
  columns: string[];
  message: string;
}> {}

export class EventSendError extends TaggedError("EventSendError")<{
  cause: unknown;
  message: string;
}> {}
