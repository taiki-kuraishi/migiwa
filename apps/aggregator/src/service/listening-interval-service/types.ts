export interface ListeningInterval {
  userId: string;
  listeningKey: string;
  syncId: string | null;
  name: string;
  details: string | null;
  state: string | null;
  startedAt: Date;
  endedAt: Date;
}
