# @migiwa/db

Turso (libSQL) database that holds the hourly aggregates: its Drizzle schema, migrations, client,
and repositories.

## Responsibilities

- Implements: the Drizzle schema and its migrations, creating the DB client, and one repository per
  table that turns query failures into `Result` errors.
- Does not implement: the aggregation itself, reading Basin, transactions (the caller opens them),
  or anything that does not touch this database.

## Usage

`createDb({ url, authToken })` returns a `Db` over `@libsql/client/web`, which runs on Workers.
Pass it to a repository. Each method returns a `Result` whose error is the repository's
`<Table>QueryError`:

```ts
const runs = new AggregationRunRepository({ db: createDb({ url, authToken }) });
const found = await runs.findByName({ name: "presence_hourly" }); // Ok(undefined) before the first run
const saved = await runs.upsert({ name: "presence_hourly", processedUntil: new Date("2026-10-19T01:00:00Z") });
```

## Migrations

After changing `src/schema.ts`, generate the migration and commit it with the schema:

```sh
bunx vp run --filter @migiwa/db generate
```

CI and the pre-commit hook rerun it and fail if it leaves a diff.

Apply the migrations to the Turso database. `fnox exec` provides `TURSO_DATABASE_URL` and
`TURSO_AUTH_TOKEN` (set `AWS_PROFILE` to a profile that can assume the role in `fnox.toml`). Run it
with `bun run`, not `vp run`, so a cache hit never skips it:

```sh
cd packages/db
fnox exec -- bun run migrate
```

## Testing

```sh
bunx vp run -r test
```

Tests apply the migrations to an in-memory libSQL database, so they need no Turso database.
