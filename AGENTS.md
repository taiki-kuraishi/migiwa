# AGENTS.md

## Language

Code comments are in Japanese; code, README, commit messages, and PRs are in English.
Design specs under `docs/specs/` and plans under `docs/plans/` are in Japanese;
`docs/plans/` is gitignored.

## Commits and PRs

Commit messages and PR titles follow `<gitmoji> <type>(<scope>): <summary>`
(scope optional), e.g. `✨ feat(bot): ...`; the type list is in
`.github/pull_request_template.md`.

## Package manager: Bun only

Always use Bun. Never npm, yarn, or pnpm.

## Running checks

Run lint, format, type-check, knip, and test through `vp run` so they go through
the Vite Task cache; a new root-only check goes in `vite.config.ts` `run.tasks`.
Each workspace defines the package.json script `type-check` (Workers also
`cf-typegen`) and defines `test` in its own `vite.config.ts` `run.tasks` as
`vp test`, not as a script: on Linux, fspy cannot see the reads of Bun, which
skips libc, so a Bun-run test would replay a stale cache (vite-task#777).
Workers on `@cloudflare/vitest-plugin` use `vitest run` there instead, since the
plugin targets the catalog's Vitest, not the one `vp test` bundles. The
root runs them across workspaces with `bunx vp run -r <task>`. Tests need
mise's Node on PATH (CI included): without it Vitest silently runs on Bun.
`bun install --frozen-lockfile --dry-run` and `bun dedupe --check` run
directly: a cache hit would skip the check itself.
Terraform checks for `infra/*` (fmt, `init -backend=false`, validate) run in
`.github/workflows/terraform.yml`, not through `vp run`: that job needs only
terraform, not Bun or Node.

## TypeScript

TypeScript 7 is a native (Go) compiler. The terminal (`bunx vp run -r type-check`)
is the source of truth for types; editors need a TS 7 LSP or they show stale
semantics. The version is sourced from `workspaces.catalog`; every workspace
declares `"typescript": "catalog:"` in `peerDependencies`. Type-aware lint is
`oxlint-tsgolint`, whose version tracks TypeScript's (`7.0.2xxx` = TS 7.0.2) —
bump both together.

## Formatting & linting

Format with oxfmt and lint with oxlint; do not add Biome, Prettier, or dprint.

## Workspaces

`apps/*` are thin deploy units (one Worker each). `packages/*` are source-only
internal packages (`@migiwa/<name>`, `exports` points at `./src/*.ts`, consumed
as source, never bundled). Shared dependency versions live in `workspaces.catalog`
and are referenced as `"catalog:"`.

## Worker app conventions

- `entry.ts` wires handlers to the app; it may hold a handler whose body is a
  single call, but routing, middleware, and business logic live in
  `server.ts` / `routes/`.
- `server.ts` starts with `export const app = new Hono<HonoEnv>()` and mounts
  routes/middlewares in a single method chain (do not break the chain — it
  preserves RPC type inference). `HonoEnv` is defined here; routes/middlewares
  import it with `import type` (a value import creates a runtime cycle).
- Naming: routes end in `Route`, middlewares in `Middleware`.

## Deploy

Cloudflare Workers Builds deploys the Workers. GitHub Actions only runs checks;
do not add a deploy workflow.

## Testing

- `packages/*` and binding-free Workers: Vitest (`vp test`), imported from
  `vite-plus/test` so specs use the runner `vp test` bundles; do not add `vitest`.
  For an MCP server, drive it through the SDK's `InMemoryTransport` + a real
  client, not direct handler calls.
- Workers that touch Cloudflare bindings: `vitest` + `@cloudflare/vitest-plugin`,
  config in `vitest.config.ts` pointed at the same `wrangler.jsonc` used for
  deploy — there is no separate test config. Call the Worker through
  `exports.default.fetch()` from `cloudflare:workers`.

## Generated code

Anything produced by a generator and committed must be registered in
`.gitattributes` with `linguist-generated=true` and never hand-edited; rerun
its generator instead. Each Worker's `worker-configuration.d.ts` comes from
`wrangler types` through its `cf-typegen` script, which runs Wrangler without
credentials (`CLOUDFLARE_API_TOKEN=` and a throwaway `XDG_CONFIG_HOME`): with
them, Wrangler fetches pipeline stream schemas and writes types that CI, which
has none, cannot reproduce. CI and lefthook regenerate it and fail on a diff.

## Comments

Comments explain **why**, not **what**. Worth writing: external constraints (an
RFC, another system's quirk), rejected alternatives, and conditions that break
something elsewhere if changed. Do not hardcode values that rot (versions, file
lists) — point at the command that derives them, unless the value itself is the
justification (a measured latency), in which case keep it and mark the date.
