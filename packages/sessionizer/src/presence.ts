import type { PresenceSession, PresenceStatus } from "@migiwa/db";

import type { PresenceLike, SessionOp } from "./types";

const TRACKED_STATUSES: readonly PresenceStatus[] = ["online", "idle", "dnd"];

// Discord also sends "offline" and (for the bot itself) "invisible"; both mean "not here".
export function presenceStatus(status: string | undefined): PresenceStatus | null {
  return TRACKED_STATUSES.find((tracked) => tracked === status) ?? null;
}

// Spec §6.3, PRESENCE_UPDATE / status.
// The partial unique index guarantees at most one open row per (guild, user), so `find` is enough.
export function reducePresenceStatus(
  open: PresenceSession[],
  d: PresenceLike,
  received_at: number,
): SessionOp[] {
  const current = open.find((row) => row.guild_id === d.guild_id && row.user_id === d.user.id),
    next = presenceStatus(d.status),
    ops: SessionOp[] = [];
  if (current !== undefined && current.status === next) {
    return [];
  }
  if (current !== undefined) {
    ops.push({
      kind: "close",
      table: "presence",
      id: current.id,
      ended_at: received_at,
      end_reason: next === null ? "offline" : "status_change",
    });
  }
  if (next !== null) {
    ops.push({
      kind: "open",
      table: "presence",
      row: {
        guild_id: d.guild_id,
        user_id: d.user.id,
        status: next,
        client_desktop: d.client_status?.desktop ?? null,
        client_mobile: d.client_status?.mobile ?? null,
        client_web: d.client_status?.web ?? null,
        started_at: received_at,
      },
    });
  }
  return ops;
}
