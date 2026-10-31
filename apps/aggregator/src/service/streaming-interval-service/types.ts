export interface StreamingInterval {
  userId: string;
  streamingKey: string;
  url: string | null;
  name: string;
  details: string | null;
  startedAt: Date;
  endedAt: Date;
}
