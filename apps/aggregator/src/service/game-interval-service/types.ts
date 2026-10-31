export interface GameInterval {
  userId: string;
  gameKey: string;
  applicationId: string | null;
  officialGameId: string | null;
  name: string;
  startedAt: Date;
  endedAt: Date;
}
