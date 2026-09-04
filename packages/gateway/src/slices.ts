import type {
  APIGatewayBotInfo,
  APIUnavailableGuild,
  APIUser,
  GatewayActivity,
  GatewayGuildCreateDispatchData,
  GatewayGuildDeleteDispatchData,
  GatewayHelloData,
  GatewayPresenceClientStatus,
  GatewayPresenceUpdateDispatchData,
  GatewayReadyDispatchData,
  GatewayVoiceState,
} from "discord-api-types/v10";

// The slices typia validates (spec D13) hold only the fields the bot reads.
// They're assembled from discord-api-types via Pick, so names and value types stay Discord's.
// Validating the full union would drop an event on any mismatch between the wire and the types.
// A slice only fails when a field the bot actually reads is wrong.
// One exception: `ActivitySlice.type` is `number`, not Pick-ed from `ActivityType`.
// Typia expands a TS enum into a closed literal union.
// Discord has already extended ActivityType once; it now runs 0-5.
// Pinning the picked type risks rejecting an entire PRESENCE_UPDATE on the next one.
// That would drop the `status` field the bot needs too, since the whole payload fails.
// `status` and `client_status` still Pick from `PresenceUpdateReceiveStatus`.
// That enum is Discord's stable presence vocabulary, unchanged since gateway v6.
// Typia's closed union there already matches Discord's documented set exactly.

export type HelloSlice = Pick<GatewayHelloData, "heartbeat_interval">;

export type ReadySlice = Pick<GatewayReadyDispatchData, "session_id" | "resume_gateway_url"> & {
  user: Pick<APIUser, "id">;
  guilds: Pick<APIUnavailableGuild, "id">[];
};

export type ActivitySlice = Pick<GatewayActivity, "name" | "created_at"> &
  Partial<Pick<GatewayActivity, "application_id" | "state" | "details">> & {
    // Not Pick-ed from GatewayActivity: see the file-level comment above.
    type: number;
  };

export type PresenceSlice = Pick<GatewayPresenceUpdateDispatchData, "guild_id"> & {
  user: Pick<APIUser, "id">;
  status?: GatewayPresenceUpdateDispatchData["status"];
  activities?: ActivitySlice[];
  client_status?: GatewayPresenceClientStatus;
};

export type VoiceStateSlice = Pick<
  GatewayVoiceState,
  | "user_id"
  | "session_id"
  | "channel_id"
  | "self_mute"
  | "self_deaf"
  | "mute"
  | "deaf"
  | "self_video"
  | "suppress"
> &
  Partial<Pick<GatewayVoiceState, "guild_id" | "self_stream">>;

export type GuildCreateSlice = Pick<
  GatewayGuildCreateDispatchData,
  "id" | "name" | "member_count" | "large"
> & {
  // Discord documents GUILD_CREATE's presences as partial presence update objects.
  // The guild id is already on `d.id`, so it is not guaranteed on each entry the way a bare
  // PresenceSlice requires. Mirrors voice_states below.
  presences: Omit<PresenceSlice, "guild_id">[];
  voice_states: Omit<VoiceStateSlice, "guild_id">[];
};

export type GuildDeleteSlice = Pick<GatewayGuildDeleteDispatchData, "id" | "unavailable">;

export type GatewayBotSlice = Pick<APIGatewayBotInfo, "url" | "shards"> & {
  session_start_limit: Pick<APIGatewayBotInfo["session_start_limit"], "remaining" | "reset_after">;
};
