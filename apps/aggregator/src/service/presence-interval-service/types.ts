import type { PresenceStatus } from "../../client/basin-sql-client";

export interface PresenceInterval {
  userId: string;
  status: PresenceStatus;
  startedAt: Date;
  endedAt: Date;
}
