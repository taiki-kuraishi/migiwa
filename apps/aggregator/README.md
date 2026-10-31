# @migiwa/aggregator

Worker that aggregates the raw Gateway dispatches in Basin (`discord.events_v1`) into the Turso
database of `@migiwa/db` on an hourly cron.

## Responsibilities

- Implements: reading `PRESENCE_UPDATE` from Basin SQL, the database connection and repositories,
  writing each user's presence as intervals (`online`, `idle`, `dnd`, `offline`) to
  `presence_intervals`, cut where the status changes, the games each user played (`activities` of
  type 0) as intervals to `game_intervals`, and the tracks each user listened to (`activities` of
  type 2) as intervals to `listening_intervals`, each cut where it appears or disappears.
- Does not implement: the schema or migrations (`@migiwa/db`), totals per day or hour
  (the API sums the intervals in SQL), serving the aggregates (REST / MCP), or recomputing hours
  already aggregated. An event that reaches Basin after its hour was aggregated is never used.

## Behavior

- The cron runs at minute 30 of every hour and runs the presence, game, and listening aggregations
  in turn; one failing does not stop the others. Each aggregation has its own
  `aggregation_runs.processed_until` (`presence_intervals`, `game_intervals`,
  `listening_intervals`) and aggregates from
  it up to the top of the hour `AGGREGATION_DELAY_MINUTES` (a `vars` entry in `wrangler.jsonc`,
  default 15) before now, at most 24 hours per run, so a backlog after downtime is caught up 24
  hours per cron. The first run aggregates only the hour before that.
- A user's last state is their intervals that ended at the previous `processed_until`. If the run
  starts in the same status (or still playing the same game, or still listening to the same
  track), that interval's `ended_at` is
  extended instead of adding a row; a user with no such interval starts at their first event. Each
  run closes the open intervals at its end.
- The same status arriving again (from several servers, or with only an activity change) continues
  the interval, and duplicate dispatches (`session_id`, `seq`) are dropped.
- Each aggregation writes its intervals and `processed_until` in one transaction that commits only
  if `processed_until` still holds the value the run read. A run that overlaps another (a slow
  cron, a manual trigger) writes nothing and logs a warning.

## Setup

- `BASIN_SQL_TOKEN` (secret `migiwa-basin-sql-token`): a read-only token with Data Catalog Read,
  Bucket Item Read on `migiwa-events`, and Basin SQL Read. Apply `infra/aws` (it creates the
  Secrets Manager secret `MIGIWA_CLOUDFLARE_BASIN_SQL_TOKEN`), store the token there with
  `fnox set`, then apply `infra/cloudflare`.
- `TURSO_AUTH_TOKEN` (secret `migiwa-turso-auth-token`): `MIGIWA_TURSO_AUTH_TOKEN`, put in the
  Secrets Store by `infra/cloudflare`.
- `TURSO_DATABASE_URL`, `BASIN_ACCOUNT_ID`, and `BASIN_BUCKET` are `vars` in `wrangler.jsonc`;
  `store_id` is `terraform output secrets_store_id`.
- Apply the `@migiwa/db` migrations before the first deploy. Workers Builds deploys this directory
  from `main`.

## Testing

```sh
bunx vp run -r test
```

`vitest run` runs two projects. `worker` runs the scheduled handler in the Workers runtime with
`@cloudflare/vitest-plugin` and the deploy `wrangler.jsonc`, with the Secrets Store bindings stubbed.
`node` runs the aggregation in Node, because its database, an in-memory libSQL with the
`@migiwa/db` migrations applied (`test/node/db.ts`), is a native module the Workers runtime
cannot load; Basin SQL is mocked with MSW there.
