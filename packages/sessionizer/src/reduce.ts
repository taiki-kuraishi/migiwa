import type { IngestEvent, OpenRows, SessionOp } from "./types";

import { reduceActivities } from "./activity";
import { reducePresenceStatus } from "./presence";
import { reduceVoice } from "./voice";

// The entry point for the dispatches reduce() handles (spec §6.3).
// GUILD_CREATE / GUILD_DELETE go through reduceGuildCreate() / reduceGuildDelete() in ./guild instead: reduceGuildCreate needs disconnected_at and returns a guild upsert alongside its SessionOp[], and reduceGuildDelete sits beside it because both are guild-lifecycle rules.
// oxlint-disable-next-line typescript/consistent-return -- the switch is exhaustive over `IngestEvent`; a missing case is TS2366, so no default and no trailing return.
export function reduce(open: OpenRows, event: IngestEvent, received_at: number): SessionOp[] {
  switch (event.t) {
    case "PRESENCE_UPDATE": {
      return [
        ...reducePresenceStatus(open.presence, event.d, received_at),
        ...reduceActivities(open.activity, event.d, received_at),
      ];
    }
    case "VOICE_STATE_UPDATE": {
      // A voice state without a guild is a DM call; nothing of ours to track.
      if (event.d.guild_id === undefined) {
        return [];
      }
      return reduceVoice(open.voice, event.d.guild_id, event.d, received_at);
    }
    // No default
  }
}
