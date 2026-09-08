import type { DatabaseClient } from "@migiwa/db";
import type { GuildCreateSlice, GuildDeleteSlice, ValidatedDispatch } from "@migiwa/gateway";

import { events, guilds } from "@migiwa/db";
import { reduce, reduceGuildCreate, reduceGuildDelete } from "@migiwa/sessionizer";
import { eq } from "drizzle-orm";

import { applyOps } from "./apply-ops";
import { loadOpenRows } from "./open-rows";

export type IngestOutcome = "ingested" | "ignored";
export type GuildFilter = (guild_id: string) => boolean;

// DISCORD_GUILD_IDS: empty (or absent, defensively — spec §8's default) keeps every guild.
export function guildFilter(raw: string | undefined): GuildFilter {
  const ids = new Set(
    (raw ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
  return (guild_id) => ids.size === 0 || ids.has(guild_id);
}

// Split out of ingestDispatch() to stay under the statement-count limit. PRESENCE_UPDATE and
// VOICE_STATE_UPDATE share this shape (guild filter, raw event, sessionizer ops); only where the
// User id lives, and whether `guild_id` is required, differs between the two slices. `payload`
// Stores the validated object, which typia hands back untrimmed, so the raw event is kept whole.
function ingestSession(
  db: DatabaseClient,
  event: Extract<ValidatedDispatch, { t: "PRESENCE_UPDATE" | "VOICE_STATE_UPDATE" }>,
  received_at: number,
  allow: GuildFilter,
): IngestOutcome {
  const { d } = event,
    { guild_id } = d,
    // Read through `event.d`, not the destructured `d` above: only that keeps the narrowing on
    // `event.t` below in effect for the property access.
    user_id = event.t === "PRESENCE_UPDATE" ? event.d.user.id : event.d.user_id;
  // A voice state without a guild is a DM call: nothing of ours to track.
  if (guild_id === undefined || !allow(guild_id)) {
    return "ignored";
  }
  db.insert(events)
    .values({ received_at, seq: event.s, type: event.t, guild_id, user_id, payload: d })
    .run();
  applyOps(db, reduce(loadOpenRows(db, guild_id, user_id), event, received_at));
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
    case "PRESENCE_UPDATE":
    case "VOICE_STATE_UPDATE": {
      return ingestSession(db, dispatch, received_at, allow);
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
