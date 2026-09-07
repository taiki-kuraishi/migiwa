import type { IngestEvent, OpenRows, SessionOp } from "./types";

import { reduceActivities } from "./activity";
import { reducePresenceStatus } from "./presence";

// The entry point for the dispatches reduce() handles (spec §6.3).
// GUILD_CREATE / GUILD_DELETE go through reduceGuildCreate() / reduceGuildDelete() (Task 19) instead, since they also return guild upserts.
// oxlint-disable-next-line typescript/consistent-return -- the switch is exhaustive over `IngestEvent`; a missing case is TS2366, so no default and no trailing return.
export function reduce(open: OpenRows, event: IngestEvent, received_at: number): SessionOp[] {
  switch (event.t) {
    case "PRESENCE_UPDATE": {
      return [
        ...reducePresenceStatus(open.presence, event.d, received_at),
        ...reduceActivities(open.activity, event.d, received_at),
      ];
    }
    // No default
  }
}
