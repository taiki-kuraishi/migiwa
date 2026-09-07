import type { GuildCreateSlice, GuildDeleteSlice } from "@migiwa/gateway";

import type { OpenRows, SessionOp, SessionTable } from "./types";

import { reduceActivities } from "./activity";
import { reducePresenceStatus } from "./presence";
import { reduceVoice } from "./voice";

// Above this size Discord trims GUILD_CREATE's presences to bots and voice participants, so
// "missing from the snapshot" no longer means "offline" (spec §6.3).
export const PRESENCE_SNAPSHOT_LIMIT = 75_000;

export interface GuildUpsert {
  guild_id: string;
  name: string;
  member_count: number | null;
  large: boolean;
  available: true;
  last_snapshot_at: number;
}

export interface GuildCreateResult {
  guild: GuildUpsert;
  ops: SessionOp[];
}

// A row shape shared by presence/activity/voice sessions, all closeGone() needs.
interface ClosableRow {
  id: number;
  guild_id: string;
  user_id: string;
}

// Shared by the three snapshot_missing reconciliation calls in reduceGuildCreate: presence, activity, and voice each need the same filter+map, just against a different table and keep-set.
// Filters by `guild_id` itself instead of trusting the caller to have pre-scoped `open` — the same defense reducePresenceStatus/reduceActivities/reduceVoice already apply to their own (guild_id, user_id) lookups (spec §6.3: close only this guild's open rows that the snapshot doesn't list).
function closeGone(
  rows: ClosableRow[],
  guild_id: string,
  keep: Set<string>,
  table: SessionTable,
  ended_at: number,
): SessionOp[] {
  return rows
    .filter((row) => row.guild_id === guild_id && !keep.has(row.user_id))
    .map((row): SessionOp => ({
      kind: "close",
      table,
      id: row.id,
      ended_at,
      end_reason: "snapshot_missing",
    }));
}

// Spec §6.3, GUILD_CREATE: apply the snapshot as if each entry were a live event, then close whatever the snapshot no longer lists. `disconnected_at` is when the bot last lost its socket; users who left while it was away ended then, not now.
export function reduceGuildCreate(
  open: OpenRows,
  d: GuildCreateSlice,
  received_at: number,
  disconnected_at: number | null,
): GuildCreateResult {
  const guild: GuildUpsert = {
      guild_id: d.id,
      name: d.name,
      member_count: d.member_count,
      large: d.large,
      available: true,
      last_snapshot_at: received_at,
    },
    presentUsers = new Set(d.presences.map((presence) => presence.user.id)),
    voiceUsers = new Set(d.voice_states.map((voice) => voice.user_id)),
    ended_at = disconnected_at ?? received_at,
    reconcilePresence = d.member_count <= PRESENCE_SNAPSHOT_LIMIT,
    applied = d.presences.flatMap((presence) => {
      const like = { ...presence, guild_id: d.id };
      return [
        ...reducePresenceStatus(open.presence, like, received_at),
        ...reduceActivities(open.activity, like, received_at),
      ];
    }),
    voiceApplied = d.voice_states.flatMap((voice) =>
      reduceVoice(open.voice, d.id, voice, received_at),
    ),
    closed = [
      ...(reconcilePresence
        ? closeGone(open.presence, d.id, presentUsers, "presence", ended_at)
        : []),
      ...(reconcilePresence
        ? closeGone(open.activity, d.id, presentUsers, "activity", ended_at)
        : []),
      ...closeGone(open.voice, d.id, voiceUsers, "voice", ended_at),
    ];
  return { guild, ops: [...applied, ...voiceApplied, ...closed] };
}

// Spec §6.3, GUILD_DELETE: an outage (`unavailable: true`) changes nothing here (apps/bot flips guilds.available); being removed closes every open row.
export function reduceGuildDelete(
  open: OpenRows,
  d: GuildDeleteSlice,
  received_at: number,
): SessionOp[] {
  if (d.unavailable === true) {
    return [];
  }
  return [
    ...open.presence.map((row): SessionOp => ({
      kind: "close",
      table: "presence",
      id: row.id,
      ended_at: received_at,
      end_reason: "guild_removed",
    })),
    ...open.activity.map((row): SessionOp => ({
      kind: "close",
      table: "activity",
      id: row.id,
      ended_at: received_at,
      end_reason: "guild_removed",
    })),
    ...open.voice.map((row): SessionOp => ({
      kind: "close",
      table: "voice",
      id: row.id,
      ended_at: received_at,
      end_reason: "guild_removed",
    })),
  ];
}
