import { describe, expect, test } from "bun:test";

import { ensureReadOnly } from "../src/read-only";

// Null when the statement is allowed, otherwise the NotReadOnlySql reason.
const reasonOf = (sql: string): string | null =>
  ensureReadOnly(sql).match({ ok: () => null, err: (error) => error.reason });

describe("ensureReadOnly", () => {
  test("accepts SELECT, WITH and EXPLAIN in any case", () => {
    expect(reasonOf("SELECT 1")).toBeNull();
    expect(reasonOf("select * from guilds limit 5")).toBeNull();
    expect(reasonOf("WITH x AS (SELECT 1) SELECT * FROM x")).toBeNull();
    expect(reasonOf("EXPLAIN QUERY PLAN SELECT 1")).toBeNull();
  });

  test("ignores leading whitespace and comments, and returns the bare statement", () => {
    expect(ensureReadOnly("  \n-- who is online\nSELECT 1;").unwrap()).toBe("SELECT 1");
    expect(reasonOf("/* block */ SELECT 1")).toBeNull();
  });

  test("allows one trailing semicolon but not a second statement", () => {
    expect(reasonOf("SELECT 1;")).toBeNull();
    expect(reasonOf("SELECT 1; DROP TABLE guilds")).toBe("multiple_statements");
    expect(reasonOf("SELECT 1;;")).toBe("multiple_statements");
  });

  test("rejects writes and everything that is not a query", () => {
    expect(reasonOf("INSERT INTO guilds VALUES (1)")).toBe("not_a_query");
    expect(reasonOf("DELETE FROM events")).toBe("not_a_query");
    expect(reasonOf("-- comment only")).toBe("not_a_query");
    expect(reasonOf("")).toBe("not_a_query");
    expect(reasonOf("SELECTX 1")).toBe("not_a_query");
  });

  test("rejects PRAGMA and ATTACH anywhere", () => {
    expect(reasonOf("SELECT 1 FROM pragma_table_info('guilds')")).toBe("forbidden_keyword");
    expect(reasonOf("PRAGMA table_info(guilds)")).toBe("not_a_query");
    expect(reasonOf("WITH x AS (SELECT 1) SELECT * FROM x; ATTACH 'a' AS b")).toBe(
      "multiple_statements",
    );
  });

  test("the error message names what is allowed", () => {
    const error = ensureReadOnly("DROP TABLE x").match({ ok: () => null, err: (e) => e });
    expect(error?.message).toContain("SELECT / WITH / EXPLAIN");
  });
});
