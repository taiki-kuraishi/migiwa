import type { ActivitySession, EndReason, PresenceSession, VoiceSession } from "@migiwa/db";
import type { PresenceSlice } from "@migiwa/gateway";

// The open rows (`ended_at IS NULL`) a rule compares against, loaded by apps/bot per event: one user's rows for PRESENCE_UPDATE / VOICE_STATE_UPDATE, the whole guild's for GUILD_CREATE.
export interface OpenRows {
  presence: PresenceSession[];
  activity: ActivitySession[];
  voice: VoiceSession[];
}

export type NewPresenceSession = Omit<PresenceSession, "id" | "ended_at" | "end_reason">;
export type NewActivitySession = Omit<ActivitySession, "id" | "ended_at" | "end_reason">;
export type NewVoiceSession = Omit<VoiceSession, "id" | "ended_at" | "end_reason">;

export type SessionTable = "presence" | "activity" | "voice";

export type VoiceFlags = Pick<
  VoiceSession,
  "self_mute" | "self_deaf" | "mute" | "deaf" | "self_stream" | "self_video" | "suppress"
>;

// What the rules emit and apps/bot applies with Drizzle (spec §6.3).
// Rules never touch the database; that keeps every rule a table-driven unit test.
export type SessionOp =
  | { kind: "open"; table: "presence"; row: NewPresenceSession }
  | { kind: "open"; table: "activity"; row: NewActivitySession }
  | { kind: "open"; table: "voice"; row: NewVoiceSession }
  | { kind: "close"; table: SessionTable; id: number; ended_at: number; end_reason: EndReason }
  | {
      kind: "update";
      table: "activity";
      id: number;
      patch: Partial<Pick<ActivitySession, "state" | "details">>;
    }
  | { kind: "update"; table: "voice"; id: number; patch: Partial<VoiceFlags> };

// The fields the presence rules read: the slice apps/bot validated with typia (spec D13).
// GUILD_CREATE's `presences[]` entries have the same shape.
export type PresenceLike = PresenceSlice;

// The dispatches apps/bot hands to reduce(). Task 18 adds VOICE_STATE_UPDATE and turns this into a union.
// At that point `typescript/consistent-type-definitions` requires `type` again, since interfaces can't express unions.
export interface IngestEvent {
  t: "PRESENCE_UPDATE";
  d: PresenceSlice;
}
