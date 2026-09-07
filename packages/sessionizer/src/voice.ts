import type { VoiceSession } from "@migiwa/db";

import type { SessionOp, VoiceFlags, VoiceStateLike } from "./types";

const FLAG_NAMES = [
    "self_mute",
    "self_deaf",
    "mute",
    "deaf",
    "self_stream",
    "self_video",
    "suppress",
  ] as const,
  flagsOf = (d: VoiceStateLike): VoiceFlags => ({
    self_mute: d.self_mute,
    self_deaf: d.self_deaf,
    mute: d.mute,
    deaf: d.deaf,
    self_stream: d.self_stream ?? false,
    self_video: d.self_video,
    suppress: d.suppress,
  });

function diffFlags(row: VoiceFlags, next: VoiceFlags): Partial<VoiceFlags> {
  const patch: Partial<VoiceFlags> = {};
  for (const name of FLAG_NAMES) {
    if (row[name] !== next[name]) {
      patch[name] = next[name];
    }
  }
  return patch;
}

// Split out to keep reduceVoice under oxlint's max-statements (10): row is already known open, so this only ever emits zero or one "update" op, the same-channel branch's whole job.
function updateOp(row: VoiceSession, next: VoiceFlags): SessionOp[] {
  const patch = diffFlags(row, next);
  return Object.keys(patch).length === 0
    ? []
    : [{ kind: "update", table: "voice", id: row.id, patch }];
}

// Spec §6.3, VOICE_STATE_UPDATE. `guild_id` is passed separately because GUILD_CREATE's voice_states[] entries do not carry it.
export function reduceVoice(
  open: VoiceSession[],
  guild_id: string,
  d: VoiceStateLike,
  received_at: number,
): SessionOp[] {
  const row = open.find((r) => r.guild_id === guild_id && r.user_id === d.user_id),
    channel = d.channel_id,
    openOp = (channel_id: string): SessionOp => ({
      kind: "open",
      table: "voice",
      row: {
        guild_id,
        user_id: d.user_id,
        channel_id,
        discord_session_id: d.session_id,
        started_at: received_at,
        ...flagsOf(d),
      },
    });
  if (row === undefined) {
    return channel === null ? [] : [openOp(channel)];
  }
  if (channel === null) {
    return [
      { kind: "close", table: "voice", id: row.id, ended_at: received_at, end_reason: "leave" },
    ];
  }
  if (channel !== row.channel_id) {
    return [
      { kind: "close", table: "voice", id: row.id, ended_at: received_at, end_reason: "move" },
      openOp(channel),
    ];
  }
  return updateOp(row, flagsOf(d));
}
