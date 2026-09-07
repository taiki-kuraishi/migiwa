import type { IngestEvent, OpenRows, SessionOp } from "./types";

import { reduceActivities } from "./activity";
import { reducePresenceStatus } from "./presence";

// The one entry point apps/bot calls per ingested dispatch (spec §6.3).
// oxlint-disable-next-line typescript/consistent-return -- the switch below is exhaustive over IngestEvent's current single variant with no `default`; `noImplicitReturns` already turns an unhandled future variant into a compile error (TS2366) without one, which this syntactic rule doesn't account for.
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
