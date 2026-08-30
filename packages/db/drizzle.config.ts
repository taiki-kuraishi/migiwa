import { defineConfig } from "drizzle-kit";

// `durable-sqlite` makes `generate` also emit drizzle/migrations.js, the bundle that
// `drizzle-orm/durable-sqlite/migrator` consumes inside the Durable Object.
export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: "./src/schemas/*",
  out: "./drizzle",
  migrations: { prefix: "timestamp" },
});
