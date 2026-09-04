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

export type HelloSlice = Pick<GatewayHelloData, "heartbeat_interval">;

export type ReadySlice = Pick<GatewayReadyDispatchData, "session_id" | "resume_gateway_url"> & {
  user: Pick<APIUser, "id">;
  guilds: Pick<APIUnavailableGuild, "id">[];
};

export type ActivitySlice = Pick<GatewayActivity, "name" | "type" | "created_at"> &
  Partial<Pick<GatewayActivity, "application_id" | "state" | "details">>;

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
  presences: PresenceSlice[];
  voice_states: Omit<VoiceStateSlice, "guild_id">[];
};

export type GuildDeleteSlice = Pick<GatewayGuildDeleteDispatchData, "id" | "unavailable">;

export type GatewayBotSlice = Pick<APIGatewayBotInfo, "url" | "shards"> & {
  session_start_limit: Pick<APIGatewayBotInfo["session_start_limit"], "remaining" | "reset_after">;
};
