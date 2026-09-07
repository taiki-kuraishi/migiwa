import type { IngestEvent, OpenRows, SessionOp } from "./types";

import { reduceActivities } from "./activity";
import { reducePresenceStatus } from "./presence";

// The one entry point apps/bot calls per ingested dispatch (spec §6.3).
export function reduce(open: OpenRows, event: IngestEvent, received_at: number): SessionOp[] {
  switch (event.t) {
    case "PRESENCE_UPDATE": {
      return [
        ...reducePresenceStatus(open.presence, event.d, received_at),
        ...reduceActivities(open.activity, event.d, received_at),
      ];
    }
    default: {
      return [];
    }
  }
}
