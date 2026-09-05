import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";

import { botStub } from "../src/bot-stub";
import { readOnlyExec } from "../src/read-only-exec";

test("schema lists the user tables with their CREATE statements", async () => {
  const tables = await botStub(env).schema();
  expect(tables.map((table) => table.name)).toEqual([
    "activity_sessions",
    "events",
    "guilds",
    "presence_sessions",
    "voice_sessions",
  ]);
  expect(tables[0]?.sql).toMatch(/^CREATE TABLE/);
});

test("query runs a SELECT and returns columns and rows", async () => {
  const result = await botStub(env).query("SELECT 1 AS one, 'a' AS text");
  expect(result.columns).toEqual(["one", "text"]);
  expect(result.rows).toEqual([[1, "a"]]);
  expect(result.truncated).toBe(false);
});

test("query rejects anything that is not a single read-only statement", async () => {
  await expect(
    botStub(env).query("INSERT INTO guilds (guild_id, name, first_seen_at) VALUES ('g', 'n', 0)"),
  ).rejects.toThrow(/SELECT/);
  await expect(botStub(env).query("SELECT 1; SELECT 2")).rejects.toThrow(/only one statement/);
});

test("query stops at 10,000 rows and says so", async () => {
  const result = await botStub(env).query(
    "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 20000) SELECT x FROM n",
  );
  expect(result.rows).toHaveLength(10_000);
  expect(result.truncated).toBe(true);
});

test("query rejects a write hidden behind a WITH clause", async () => {
  await expect(botStub(env).query("WITH x AS (SELECT 1) DELETE FROM guilds")).rejects.toThrow(
    /`delete`/,
  );
});

// The second layer is exercised without the regex in front of it (spec §7.3): this is the test
// That proves rollback, not just refusal.
test("readOnlyExec rolls back a statement that wrote rows", async () => {
  await runInDurableObject(botStub(env), (_instance, ctx) => {
    ctx.storage.sql.exec("INSERT INTO guilds (guild_id, name, first_seen_at) VALUES ('g', 'n', 0)");
    expect(() => readOnlyExec(ctx.storage, "DELETE FROM guilds")).toThrow(/rolled back/);
    expect(ctx.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM guilds").one().n).toBe(1);
  });
});

test("readOnlyExec lets reads that sort, group or recurse through", async () => {
  await runInDurableObject(botStub(env), (_instance, ctx) => {
    expect(() =>
      readOnlyExec(ctx.storage, "SELECT guild_id FROM guilds ORDER BY name"),
    ).not.toThrow();
    expect(() =>
      readOnlyExec(ctx.storage, "SELECT status, count(*) FROM presence_sessions GROUP BY status"),
    ).not.toThrow();
    expect(() =>
      readOnlyExec(
        ctx.storage,
        "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 20000) " +
          "SELECT x FROM n ORDER BY x DESC",
      ),
    ).not.toThrow();
  });
});
