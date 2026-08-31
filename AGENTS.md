# AGENTS.md

## Language

Code, code comments, README, commit messages, and PRs are in English.
Design specs under `docs/specs/` and plans under `docs/plans/` are in Japanese;
`docs/plans/` is gitignored.

## Package manager: Bun only

Always use Bun. Never npm, yarn, or pnpm. The version is pinned in
`packageManager` and `mise.toml`.

## TypeScript

TypeScript 7 is a native (Go) compiler. The terminal (`bun run type-check`,
`bunx vp run -r type-check`) is the source of truth for types; editors need a TS 7
LSP or they show stale semantics. The version is sourced from
`workspaces.catalog`; every workspace declares `"typescript": "catalog:"` in
`peerDependencies`. Type-aware lint is `oxlint-tsgolint`, whose version tracks
TypeScript's (`7.0.2xxx` = TS 7.0.2) — bump both together.

## Formatting & linting

- Formatter: `oxfmt` (`oxfmt.config.ts`). Linter: `oxlint` (`oxlint.config.ts`).
- No Biome, Prettier, or dprint.

## Workspaces

`apps/*` are thin deploy units (one Worker each). `packages/*` are source-only
internal packages (`@migiwa/<name>`, `exports` points at `./src/*.ts`, consumed
as source, never bundled). Shared dependency versions live in `workspaces.catalog`
and are referenced as `"catalog:"`.

## Worker app conventions

- `entry.ts` wires handlers to the app; it may hold a handler whose body is a
  single call, but routing, middleware, and business logic live in
  `server.ts` / `routes/`:

  ```ts
  export default {
    fetch: app.fetch,
    async scheduled(_controller, env, _ctx) {
      await botStub(env).ensureConnected();
    },
  } satisfies ExportedHandler<Cloudflare.Env>;
  ```
- `server.ts` starts with `export const app = new Hono<HonoEnv>()` and mounts
  routes/middlewares in a single method chain (do not break the chain — it
  preserves RPC type inference). `HonoEnv` is defined here; routes/middlewares
  import it with `import type` (a value import creates a runtime cycle).
- Naming: routes end in `Route`, middlewares in `Middleware`.

## Testing

- `packages/*` and binding-free Workers: `bun test`. For an MCP server, drive it
  through the SDK's `InMemoryTransport` + a real client, not direct handler calls.
- Workers that touch real bindings (Durable Objects, D1, KV): `vitest` +
  `@cloudflare/vitest-plugin` (the package formerly named
  `@cloudflare/vitest-pool-workers`), config in `vitest.config.ts` pointed at the
  same `wrangler.jsonc` used for `wrangler deploy` — there is no separate test
  config. Call the Worker through `exports.default.fetch()` from
  `cloudflare:workers`; reach inside a Durable Object with `runInDurableObject` from
  `cloudflare:test`.

## Generated code

Anything produced by a generator and committed must be registered in
`.gitattributes` with `linguist-generated=true` and never hand-edited. Current:
`apps/*/worker-configuration.d.ts` (`wrangler types`, via `bunx vp run -r cf-typegen`;
CI checks it with `wrangler types --check`),
`packages/db/drizzle/**` (`drizzle-kit generate`, run via `bun run generate:migration` in
`packages/db`; the hand-written type shim `drizzle/migrations.d.ts` beside it is the one
exception).

## Comments

Comments explain **why**, not **what**. Worth writing: external constraints (an
RFC, another system's quirk), rejected alternatives, and conditions that break
something elsewhere if changed. Do not hardcode values that rot (versions, file
lists) — point at the command that derives them, unless the value itself is the
justification (a measured latency), in which case keep it and mark the date.
