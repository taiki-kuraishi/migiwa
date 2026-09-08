import type { DatabaseClient } from "@migiwa/db";
import type {
  GuildCreateSlice,
  GuildDeleteSlice,
  PresenceSlice,
  ValidatedDispatch,
  VoiceStateSlice,
} from "@migiwa/gateway";

import { events, guilds } from "@migiwa/db";
import { reduce, reduceGuildCreate, reduceGuildDelete } from "@migiwa/sessionizer";
import { eq } from "drizzle-orm";

import { applyOps } from "./apply-ops";
import { loadOpenRows } from "./open-rows";

export type IngestOutcome = "ingested" | "ignored";
export type GuildFilter = (guild_id: string) => boolean;

// DISCORD_GUILD_IDS: empty keeps every guild (spec §8).
export function guildFilter(raw: string): GuildFilter {
  const ids = new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== ""),
  );
  return ids.size === 0 ? () => true : (guild_id) => ids.has(guild_id);
}

// Split out of ingestDispatch() to stay under the statement-count limit. `payload` stores the
// Validated object, which typia hands back untrimmed, so the raw event is kept whole.
function ingestPresence(
  db: DatabaseClient,
  d: PresenceSlice,
  s: number,
  received_at: number,
  allow: GuildFilter,
): IngestOutcome {
  if (!allow(d.guild_id)) {
    return "ignored";
  }
  db.insert(events)
    .values({
      received_at,
      seq: s,
      type: "PRESENCE_UPDATE",
      guild_id: d.guild_id,
      user_id: d.user.id,
      payload: d,
    })
    .run();
  applyOps(
    db,
    reduce(loadOpenRows(db, d.guild_id, d.user.id), { t: "PRESENCE_UPDATE", d }, received_at),
  );
  return "ingested";
}

// Split out of ingestDispatch() to stay under the statement-count limit.
function ingestVoice(
  db: DatabaseClient,
  d: VoiceStateSlice,
  s: number,
  received_at: number,
  allow: GuildFilter,
): IngestOutcome {
  // A voice state without a guild is a DM call: nothing of ours to track.
  if (d.guild_id === undefined || !allow(d.guild_id)) {
    return "ignored";
  }
  db.insert(events)
    .values({
      received_at,
      seq: s,
      type: "VOICE_STATE_UPDATE",
      guild_id: d.guild_id,
      user_id: d.user_id,
      payload: d,
    })
    .run();
  applyOps(
    db,
    reduce(loadOpenRows(db, d.guild_id, d.user_id), { t: "VOICE_STATE_UPDATE", d }, received_at),
  );
  return "ingested";
}

// Split out of ingestDispatch() to stay under the statement-count limit.
function ingestGuildCreate(
  db: DatabaseClient,
  d: GuildCreateSlice,
  s: number,
  received_at: number,
  disconnected_at: number | null,
  allow: GuildFilter,
): IngestOutcome {
  if (!allow(d.id)) {
    return "ignored";
  }
  const { guild, ops } = reduceGuildCreate(loadOpenRows(db, d.id), d, received_at, disconnected_at);
  db.insert(guilds)
    .values({ ...guild, first_seen_at: received_at })
    .onConflictDoUpdate({ target: guilds.guild_id, set: guild })
    .run();
  // Trimmed on purpose (spec §6.2): the full GUILD_CREATE carries every member and channel.
  db.insert(events)
    .values({
      received_at,
      seq: s,
      type: "GUILD_CREATE",
      guild_id: d.id,
      user_id: null,
      payload: {
        id: d.id,
        name: d.name,
        member_count: d.member_count,
        large: d.large,
        presences_count: d.presences.length,
        voice_states_count: d.voice_states.length,
      },
    })
    .run();
  applyOps(db, ops);
  return "ingested";
}

// Split out of ingestDispatch() to stay under the statement-count limit.
function ingestGuildDelete(
  db: DatabaseClient,
  d: GuildDeleteSlice,
  received_at: number,
  allow: GuildFilter,
): IngestOutcome {
  if (!allow(d.id)) {
    return "ignored";
  }
  db.update(guilds).set({ available: false }).where(eq(guilds.guild_id, d.id)).run();
  applyOps(db, reduceGuildDelete(loadOpenRows(db, d.id), d, received_at));
  return "ingested";
}

// Runs inside the dispatch transaction (spec §6.4). The dispatch already passed
// `validateDispatch()` (spec D13), so every field the rules read is known to be there; the only
// Question left (per event type above) is whether the guild is one we keep.
export function ingestDispatch(
  db: DatabaseClient,
  dispatch: ValidatedDispatch,
  received_at: number,
  disconnected_at: number | null,
  allow: GuildFilter,
): IngestOutcome {
  switch (dispatch.t) {
    case "PRESENCE_UPDATE": {
      return ingestPresence(db, dispatch.d, dispatch.s, received_at, allow);
    }
    case "VOICE_STATE_UPDATE": {
      return ingestVoice(db, dispatch.d, dispatch.s, received_at, allow);
    }
    case "GUILD_CREATE": {
      return ingestGuildCreate(db, dispatch.d, dispatch.s, received_at, disconnected_at, allow);
    }
    case "GUILD_DELETE": {
      return ingestGuildDelete(db, dispatch.d, received_at, allow);
    }
    default: {
      return "ignored";
    }
  }
}
