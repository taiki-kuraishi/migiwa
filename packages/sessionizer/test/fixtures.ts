import type { ActivitySession, PresenceSession, VoiceSession } from "@migiwa/db";

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

/**
 * @public Unused until Task 17 (the activity rule) starts calling it; knip's `@public` tag keeps
 * this one export out of the dead-export report without hiding unrelated dead code in this file.
 * Remove this tag once Task 17 lands and imports `activityRow`.
 */
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

/**
 * @public Unused until Task 18 (Wave 11, the voice rule) starts calling it; knip's `@public` tag
 * keeps this one export out of the dead-export report without hiding unrelated dead code in this
 * file. Remove this tag once Task 18 lands and imports `voiceRow` from `test/voice.spec.ts`.
 */
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
