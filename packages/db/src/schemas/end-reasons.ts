// Why a session row was closed (spec §6.2). Shared by the three session tables.
export const END_REASONS = [
  "status_change",
  "offline",
  "activity_end",
  "leave",
  "move",
  "snapshot_missing",
  "guild_removed",
  "timeout",
] as const;
export type EndReason = (typeof END_REASONS)[number];
