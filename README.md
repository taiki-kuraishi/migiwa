# migiwa

Ingest Discord Gateway events into per-bot SQLite on Cloudflare Durable Objects,
sessionize presence / activity / voice, and query them over MCP.

> Status: v1 in progress. See `docs/specs/` for the design (Japanese).

## Architecture

- `migiwa-bot` — a Durable Object holding one Discord Gateway connection per bot,
  sessionizing events into SQLite.
- `migiwa-api` — a Worker exposing an MCP `query` tool and a `/health` endpoint.

## Develop

```sh
bun install
bun test          # packages/* unit tests
bun run type-check
```

## Self-host

Documented once `migiwa-api` lands (PR 8): two `wrangler secret put` and two
`wrangler deploy`, then point an MCP client at `/mcp`.

## License

AGPL-3.0-only. See `LICENSE`.
