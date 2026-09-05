import { defineConfig } from "drizzle-kit";

// CI-only twin of drizzle.config.ts, run by `bun run test:migration`.
// The migration folder is plain SQLite; `durable-sqlite` only adds the migrations.js bundle.
// Dropping `driver` therefore lets drizzle-kit replay the same .sql and prove it applies.
// A Durable Object is unreachable from CI; apps/bot's vitest runs migrate() on real workerd.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schemas/*",
  out: "./drizzle",
  migrations: { prefix: "timestamp" },
  dbCredentials: { url: ":memory:" },
});
