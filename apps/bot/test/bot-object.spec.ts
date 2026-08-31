import { presence_sessions } from "@migiwa/db";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";

import { botStub } from "../src/bot-stub";

const USER_TABLES = [
  "activity_sessions",
  "events",
  "guilds",
  "presence_sessions",
  "voice_sessions",
];

// Besides user tables, sqlite_master lists sqlite_sequence (AUTOINCREMENT), __drizzle_migrations
// And workerd's _cf_* internals, so user tables are whatever is left after dropping those prefixes.
function userTables(sql: SqlStorage): string[] {
  return sql
    .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .toArray()
    .map((row) => row.name)
    .filter((name) => !/^(?<prefix>sqlite_|__|_cf_)/.test(name));
}

test("the constructor applies the @migiwa/db migrations", async () => {
  await runInDurableObject(botStub(env), (_instance, state) => {
    expect(userTables(state.storage.sql)).toEqual(USER_TABLES);
  });
});

test("re-constructing the object after eviction does not re-run migrations", async () => {
  const stub = botStub(env);
  await stub.status();
  await evictDurableObject(stub);
  await runInDurableObject(stub, (_instance, state) => {
    const applied = state.storage.sql
      .exec<{ n: number }>("SELECT count(*) AS n FROM __drizzle_migrations")
      .one();
    expect(applied.n).toBe(1);
    expect(userTables(state.storage.sql)).toEqual(USER_TABLES);
  });
});

test("status reports stopped until the gateway client exists", async () => {
  const report = await botStub(env).status();
  expect(report.state).toBe("stopped");
  expect(await botStub(env).ensureConnected()).toEqual(report);
});

test("the open-session unique index holds inside a synchronous transaction", async () => {
  await runInDurableObject(botStub(env), (instance) => {
    const open = { guild_id: "g", user_id: "u", status: "online" as const, started_at: 1 };
    expect(() =>
      instance.db.transaction((tx) => {
        tx.insert(presence_sessions).values(open).run();
        tx.insert(presence_sessions).values(open).run();
      }),
    ).toThrow(/UNIQUE/);
    // The failed transaction rolled back, so the storage this file shares stays empty.
    expect(instance.db.select().from(presence_sessions).all()).toEqual([]);
  });
});
