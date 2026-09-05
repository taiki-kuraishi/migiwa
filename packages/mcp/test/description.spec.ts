import { describe, expect, test } from "bun:test";

import { buildDescription } from "../src/description";

describe("buildDescription", () => {
  test("names every table and tells the model to LIMIT", () => {
    const text = buildDescription([
      { name: "guilds", sql: "CREATE TABLE guilds (guild_id text)" },
      { name: "events", sql: "CREATE TABLE events (id integer)" },
    ]);
    expect(text).toContain("guilds");
    expect(text).toContain("events");
    expect(text).toContain("LIMIT");
  });
});
