# migiwa

Discord presence, activity and voice sessions on Cloudflare Workers and Durable Objects,
queried through MCP.

> Status: being rebuilt from scratch. The design is
> `docs/superpowers/specs/2026-09-03-rebuild-design.md` and the plan is
> `docs/superpowers/plans/2026-09-04-rebuild.md` (both Japanese). Until the plan's last wave
> lands, this README only covers the toolchain.

## Develop

```sh
mise install
bun install
mise exec -- lefthook install
bunx vp run oxlint --deny-warnings && bunx vp run oxfmt --check && bunx vp run type-check && bunx vp run -r type-check && bun run knip && bun dedupe --check
```

## License

AGPL-3.0-only. See `LICENSE`.
