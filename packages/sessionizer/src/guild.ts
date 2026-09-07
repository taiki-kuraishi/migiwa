import type { EndReason } from "@migiwa/db";
import type { GuildCreateSlice, GuildDeleteSlice } from "@migiwa/gateway";

import type { OpenRows, SessionOp, SessionTable } from "./types";

import { reduceActivities } from "./activity";
import { reducePresenceStatus } from "./presence";
import { reduceVoice } from "./voice";

// Above 75,000 members Discord trims `presences`, so reconciliation would close everyone
// (spec §6.3); the exact trimming rule is Discord's and may change.
const PRESENCE_SNAPSHOT_LIMIT = 75_000;

export interface GuildUpsert {
  guild_id: string;
  name: string;
  member_count: number;
  large: boolean;
  available: true;
  last_snapshot_at: number;
}

// Spec §6.3: both GUILD_CREATE and GUILD_DELETE only touch this guild's open rows.
// Filters by `guild_id` itself rather than trusting the caller to pre-scope `open`.
function closeGone(
  open: OpenRows,
  tables: SessionTable[],
  guild_id: string,
  keep: Set<string>,
  ended_at: number,
  end_reason: EndReason,
): SessionOp[] {
  return tables.flatMap((table): SessionOp[] =>
    open[table]
      .filter((row) => row.guild_id === guild_id && !keep.has(row.user_id))
      // Clamp: a disconnect before this row's started_at must not backdate its close before its own start.
      .map((row): SessionOp => ({
        kind: "close",
        table,
        id: row.id,
        ended_at: Math.max(ended_at, row.started_at),
        end_reason,
      })),
  );
}

// Spec §6.3, GUILD_CREATE. `disconnected_at` is when the bot last lost its socket; users who left while it was away ended then, not now.
export function reduceGuildCreate(
  open: OpenRows,
  d: GuildCreateSlice,
  received_at: number,
  disconnected_at: number | null,
): { guild: GuildUpsert; ops: SessionOp[] } {
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
        ? closeGone(
            open,
            ["presence", "activity"],
            d.id,
            presentUsers,
            ended_at,
            "snapshot_missing",
          )
        : []),
      ...closeGone(open, ["voice"], d.id, voiceUsers, ended_at, "snapshot_missing"),
    ];
  return { guild, ops: [...applied, ...voiceApplied, ...closed] };
}

// Spec §6.3, GUILD_DELETE: an outage (`unavailable: true`) changes nothing here (apps/bot flips guilds.available); being removed closes every open row of this guild.
export function reduceGuildDelete(
  open: OpenRows,
  d: GuildDeleteSlice,
  received_at: number,
): SessionOp[] {
  if (d.unavailable === true) {
    return [];
  }
  // No keep-set: unlike reduceGuildCreate's snapshot, nobody survives a guild removal.
  return closeGone(
    open,
    ["presence", "activity", "voice"],
    d.id,
    new Set(),
    received_at,
    "guild_removed",
  );
}
