# @migiwa/db

Shared Drizzle schema and generated migrations for the Turso database.

## Responsibilities

- Implements: defining and exporting the tables, generating migrations, and applying them with
  Drizzle Kit.
- Does not implement: database connections, transactions, queries, repositories, aggregation, or
  test database helpers. Each app owns its database access code.

## Usage

Import the tables from `@migiwa/db`, or import the whole schema when creating a Drizzle instance
in the consuming app:

```ts
import * as schema from "@migiwa/db";
import { drizzle } from "drizzle-orm/libsql/web";

const db = drizzle({ client, schema });
```

`presence_intervals` records each user's `status` (`online`, `idle`, `dnd`, `offline`) from
`started_at` to `ended_at` (ms), without day or hour boundaries. The aggregator advances the
`presence_intervals` entry in `aggregation_runs.processed_until` in the same transaction as its
interval writes.

## Migrations

After changing `src/schema.ts`, generate the migration and commit it with the schema:

```sh
bunx vp run --filter @migiwa/db generate
```

CI and the pre-commit hook rerun it and fail if it leaves a diff.

Apply migrations to Turso with `fnox exec`, which provides `TURSO_DATABASE_URL` and
`TURSO_AUTH_TOKEN` (set `AWS_PROFILE` to a profile that can assume the role in `fnox.toml`). Run it
with `bun run`, not `vp run`, so a cache hit never skips it:

```sh
cd packages/db
fnox exec -- bun run migrate
```

## Testing

The consuming app tests its queries and transactions against an in-memory libSQL database with
these migrations applied. Run them with:

```sh
bunx vp run --filter @migiwa/aggregator test
```
