// https://docs.discord.com/developers/events/gateway#gateway-intents
export const Intent = {
  Guilds: 1 << 0,
  GuildVoiceStates: 1 << 7,
  GuildPresences: 1 << 8,
} as const;

// GUILDS and GUILD_VOICE_STATES are always requested: GUILD_CREATE snapshots and voice states drive sessionization even when those events are not stored themselves.
// GUILD_PRESENCES is a privileged intent, so it is requested only when PRESENCE_UPDATE is actually wanted.
export function intentsFor(allowlist: ReadonlySet<string>): number {
  let intents: number = Intent.Guilds | Intent.GuildVoiceStates;
  if (allowlist.has("PRESENCE_UPDATE")) {
    intents |= Intent.GuildPresences;
  }
  return intents;
}
