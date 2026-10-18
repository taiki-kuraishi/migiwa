# @migiwa/bot

Worker whose single Durable Object stays connected to the Discord Gateway and sends each dispatch
that carries the stream's required columns to the Basin stream `migiwa_events_v1` (schema in
`infra/cloudflare/main.tf`).

## Responsibilities

- Implements: running the Gateway connection for `@migiwa/gateway` (the socket, heartbeats and
  reconnects on the Durable Object alarm, persisting `GatewayState`), sending each dispatch as one
  record, and `GET /health`.
- Does not implement: the Gateway protocol (`@migiwa/gateway`), retrying or buffering records,
  aggregation, or any query API. A send the stream rejects is logged. A send still pending after
  10 s is logged and no longer awaited, but it is not cancelled, so its outcome is unknown and the
  record may still land. Heartbeats and reconnects never wait on a send.

## Interface

- `GET /health` (no auth) → 200 with the Durable Object's `status()`:
  `{ state, hasSession, lastReceivedAt }`, where `state` is `idle`, `connecting`, `connected`, or
  `stopped` and `lastReceivedAt` is the last frame from Discord in ms.
- A cron every minute calls `ensureConnected()`, which starts the connection or re-arms the alarm.
  `stopped` follows a close code Discord does not allow reconnecting after (bad token, disallowed
  intents, sharding). It is kept only in memory, so it lasts until the Durable Object restarts (a
  deploy or an eviction); the next cron then connects again.
- Each record is `{ received_at, type, session_id, seq, guild_id, channel_id, user_id, payload }`.
  `guild_id` is `data.guild_id`, or `data.id` for `GUILD_*`; `channel_id` is `data.channel_id`, or
  `data.id` for `CHANNEL_*` and `THREAD_*`; `user_id` is the first of `user.id`, `user_id`,
  `author.id`, `member.user.id`; IDs inside arrays are ignored, and a missing ID is `null`. A dispatch missing `received_at`,
  `type`, `session_id`, or `payload` is logged instead of sent, since Pipelines drops it silently.

## Setup

The bot token comes from the Secrets Store binding `DISCORD_BOT_TOKEN` (secret
`migiwa-discord-bot-token`, created by `infra/cloudflare`; `store_id` in `wrangler.jsonc` is
`terraform output secrets_store_id`). It is read once per Durable Object start, so a new value takes
effect on the next restart. Workers Builds deploys this directory from `main`.

## Testing

```sh
bunx vp run -r test
```

Discord's REST API and Gateway are mocked with `@msw/cloudflare`; the Pipelines binding and the
Secrets Store binding (empty in tests) are spied on.
