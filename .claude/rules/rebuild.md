# Rebuild conventions

Rules harvested from review findings during the 14-wave rebuild
(`docs/superpowers/plans/2026-09-04-rebuild.md`). They apply to the whole repository,
not only to rebuild work.

## Time-bound notes

A note in repo docs that is only true during part of the rebuild must state the condition
that makes it false, and the plan task that makes it false must carry the step that removes
it. A wave number may sit alongside the condition as a navigational aid — what stays
forbidden is a bare wave number standing in for the condition. `until wave 6` was already
wrong when it was written; `while no workspace declares a test script` would not have been,
and neither would `while no workspace declares a test script (wave 6)`.

## Registering a generated file

A newly committed generated file is registered in four places, not one:

- `.gitattributes` — `linguist-generated=true`, plus a `-linguist-generated` negation for any
  hand-written file in the same tree.
- `oxlint.config.ts` and `oxfmt.config.ts` — `ignorePatterns`.
- `.editorconfig` — generators do not follow the repo's whitespace rules.

Check each of the four first: an existing glob (`apps/*/…`, `**/…`) may already cover the new
path, in which case it needs no entry there. `apps/remote-mcp/worker-configuration.d.ts`
needed none in wave 6 — the `apps/*` and `**/…` globs already in `.gitattributes`,
`oxlint.config.ts`, `oxfmt.config.ts` and `.editorconfig` all already matched it. Add an entry
only where the existing globs miss the path.

Name the CI step that detects drift in it, and say whether that step compares the file body
or only a header — `cf-typegen --check` compares only a header.

## `discord-api-types` value imports

Import enum and other runtime values from a subpath such as `discord-api-types/gateway/v10`,
never from the top-level `discord-api-types/v10` barrel. `import type` may still use the
barrel — type-only imports are erased at compile time and unaffected.

The barrel's `.js` re-exports every subpath with TypeScript's `__exportStar` helper, which
installs each name on `exports` as a getter (`Object.defineProperty` with a `get`), not a plain
data property. `discord-api-types/v10.mjs` then does `export const X = mod.X` for every name,
reading each getter exactly once and snapshotting the result into a `const`. Under
`apps/bot`'s `@cloudflare/vitest-plugin` runtime, that snapshot read comes back `undefined`.
A subpath like `discord-api-types/gateway/v10` does not have this problem: `gateway/v10.js`
defines `GatewayOpcodes` and friends itself, as an own data property assignment
(`exports.GatewayOpcodes = GatewayOpcodes`), so `gateway/v10.mjs`'s equivalent `const` snapshot
reads a real value instead of an unresolved getter.

`@migiwa/gateway` re-exports the Gateway enums app code needs (`GatewayDispatchEvents`,
`GatewayIntentBits`, `GatewayOpcodes`); app code should get them from there rather than import
`discord-api-types` directly.

## The `GOROOT` hazard

`ttsc` hashes `GOROOT` into its plugin cache key and only sets it when unset. An ambient
`GOROOT`/`GOBIN` export from a machine-level mise or asdf Go install therefore poisons every
`ttsc` invocation in a workspace that uses typia, breaking every test with a Go version
mismatch between that install and `ttsc`'s own bundled Go toolchain. This cost two
implementers a debugging session before it was written down anywhere. Prefix the affected
command with `env -u GOROOT -u GOBIN` to clear the ambient values.

CI is not exposed: `mise.toml` lists only `bun` and `lefthook`, so no Go install ever lands
on a runner's `PATH`. The Cloudflare Workers Builds image that runs the actual deploy is on
the same critical path but is not under this repo's control, so the hazard can still surface
there.

## Mocks that accept too much

A mock that accepts more than the real service turns its test into a no-op. When a task's test
suite fakes an external service, state in the task what the real service **rejects** that the
mock accepts, and say which behaviour therefore has no test.

The wave-8 mock Discord accepts a RESUME regardless of the preceding close code, so the test
named for op 7 Reconnect passed green while the real gateway would have dropped the session on
every reconnect — only the 24-hour soak would have found it.

## Wiring typia into a workspace

Every workspace that *executes* a `typia.validate<T>()` call needs the transform wired into
whatever runs it: a `bunfig.toml` with `[test] preload = ["@ttsc/unplugin/bun-register"]` for
`bun test`, `@ttsc/unplugin/vite` in the vitest config, and a pre-build for the Worker bundle. A
workspace that only imports **types** from a validating package needs none of it. An untransformed
call throws at call time, so the failure is loud — but it is loud in whichever runner you forgot.

## Pointing a Worker's `main` at a build artifact

Pointing a Worker's `main` at a build artifact makes `wrangler types` emit
`import("./dist/entry")`, which TypeScript cannot resolve — the artifact is JavaScript and
`allowJs` is off — so every generic in the generated `Env` silently degrades to `any`.
`skipLibCheck` hides the error and `cf-typegen --check` only compares a header hash, so no gate
catches it. Commit a two-line `dist/entry.d.ts` re-exporting the source entry, negated in
`.gitignore`.

## Fixtures obtained through the code under test

A test that obtains its fixture *through* the code under test cannot pin what that code chose.
`apps/remote-mcp`'s health test reached the fake Durable Object via `botStub()` — the same
function the route calls — so renaming the instance moved both together and every test stayed
green, and the post-deploy `curl` could not catch it either because the real `status()` returns
the same body for every instance. Derive the fixture independently: state the identifier once in
the test and once in the implementation, so a divergence fails.
