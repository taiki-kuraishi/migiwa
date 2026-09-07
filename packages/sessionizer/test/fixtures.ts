import type { ActivitySession, PresenceSession, VoiceSession } from "@migiwa/db";
import type { PresenceSlice } from "@migiwa/gateway";

let nextId = 1;

// Avoids `no-plusplus`: same effect as `nextId++` (return-then-increment), spelled without it.
const allocateId = (): number => {
  const id = nextId;
  nextId += 1;
  return id;
};

export function presenceRow(overrides: Partial<PresenceSession> = {}): PresenceSession {
  return {
    id: allocateId(),
    guild_id: "g1",
    user_id: "u1",
    status: "online",
    client_desktop: "online",
    client_mobile: null,
    client_web: null,
    started_at: 1000,
    ended_at: null,
    end_reason: null,
    ...overrides,
  };
}

export function activityRow(overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    id: allocateId(),
    guild_id: "g1",
    user_id: "u1",
    activity_type: 0,
    activity_key: "app-1",
    application_id: "app-1",
    name: "Game",
    state: null,
    details: null,
    started_at: 1000,
    ended_at: null,
    end_reason: null,
    ...overrides,
  };
}

export function voiceRow(overrides: Partial<VoiceSession> = {}): VoiceSession {
  return {
    id: allocateId(),
    guild_id: "g1",
    user_id: "u1",
    channel_id: "c1",
    discord_session_id: "vs-1",
    started_at: 1000,
    ended_at: null,
    end_reason: null,
    self_mute: false,
    self_deaf: false,
    mute: false,
    deaf: false,
    self_stream: false,
    self_video: false,
    suppress: false,
    ...overrides,
  };
}

// `status` is a raw string here, but PresenceSlice.status is Discord's PresenceUpdateReceiveStatus string enum; a literal string isn't assignable to it without a cast.
export function presenceUpdate(overrides: Record<string, unknown> = {}): PresenceSlice {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only fixture shape, see comment above
  return { user: { id: "u1" }, guild_id: "g1", status: "online", ...overrides } as PresenceSlice;
}
