import type { TableInfo } from "@migiwa/gateway";

// Minimal until wave 14 turns this into the per-column guide (spec §7.2).
// Even now the text comes from the live sqlite_master, so it never names a table that does not exist.
export function buildDescription(tables: TableInfo[]): string {
  return [
    "Run one read-only SQL statement (SELECT, WITH or EXPLAIN) against the bot's SQLite " +
      "database. Returns { columns, rows, rows_read, truncated }; rows stop at 10,000, so " +
      "always add a LIMIT.",
    `Tables: ${tables.map((table) => table.name).join(", ")}`,
  ].join("\n");
}
