import type { presenceStatuses } from "./constants";

export type PresenceStatus = (typeof presenceStatuses)[number];

export interface PresenceUpdate {
  userId: string;
  receivedAt: Date;
  status: PresenceStatus;
  // 同じ ms に届いた変化の順を、同じ session の中の seq で決める。
  sessionId: string;
  seq: number | null;
}
