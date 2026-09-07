// Hand-written companion to the generated migrations.js: drizzle-kit emits only the .js,
// and tsconfig.base.json keeps allowJs off. Regenerating migrations never touches this file.
import type { migrate } from "drizzle-orm/durable-sqlite/migrator";

declare const migrations: Parameters<typeof migrate>[1];
export default migrations;
