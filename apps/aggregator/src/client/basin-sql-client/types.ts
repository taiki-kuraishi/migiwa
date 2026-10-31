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

// 1 つの PRESENCE_UPDATE の時点で遊んでいたゲーム（activities の type 0）。key は application_id、無ければ name。
export interface Game {
  key: string;
  applicationId: string | null;
  officialGameId: string | null;
  name: string;
}

export interface GameUpdate {
  userId: string;
  receivedAt: Date;
  sessionId: string;
  seq: number | null;
  // その時点で遊んでいたゲームのすべて。空なら何も遊んでいない。
  games: Game[];
}

// 1 つの PRESENCE_UPDATE の時点で聴いていた曲（activities の type 2）。key は sync_id、無ければ name。
export interface Listening {
  key: string;
  syncId: string | null;
  name: string;
  details: string | null;
  state: string | null;
}

export interface ListeningUpdate {
  userId: string;
  receivedAt: Date;
  sessionId: string;
  seq: number | null;
  // その時点で聴いていた曲のすべて。空なら何も聴いていない。
  listenings: Listening[];
}

// 1 つの PRESENCE_UPDATE の時点で続けていた配信（activities の type 1）。key は url、無ければ name。
export interface Streaming {
  key: string;
  url: string | null;
  name: string;
  details: string | null;
}

export interface StreamingUpdate {
  userId: string;
  receivedAt: Date;
  sessionId: string;
  seq: number | null;
  // その時点で続けていた配信のすべて。空なら配信していない。
  streamings: Streaming[];
}
