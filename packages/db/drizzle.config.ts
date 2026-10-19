import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "turso",
  schema: "./src/schema.ts",
  out: "./drizzle",
  // Migrate だけが使う。generate は DB に繋がないので、値が無くても走る。
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? "",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
