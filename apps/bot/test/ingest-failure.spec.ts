import { presence_sessions } from "@migiwa/db";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";

import { botStub } from "../src/bot-stub";
import { readGateway } from "../src/gateway-state";
import { connectAndWait, POLL, state } from "./helpers";
import { resetBot } from "./mock-discord/cleanup";
import { mockDiscord } from "./mock-discord/client";

afterEach(resetBot);

const seqNow = async () =>
  runInDurableObject(botStub(env), (_instance, ctx) => readGateway(ctx.storage.kv, Date.now()).seq);

// Spec §9: an exception mid-dispatch is logged and the socket stays open — `try/catch` in
// OnMessage() exists only to hold a bug, not to route around an expected failure. Dropping
// `events` (the table every ingest path inserts into first) is a production-code-free way to
// Force `transactionSync`'s callback to throw, in a file of its own since the table stays
// Dropped for every other test that would otherwise share this DO.
test("an exception mid-dispatch is logged, rolls back seq, and leaves the socket connected", async () => {
  await connectAndWait();
  const seqBefore = await seqNow(),
    logSpy = vi.spyOn(console, "log");
  await runInDurableObject(botStub(env), (_instance, ctx) => {
    ctx.storage.sql.exec("DROP TABLE events");
  });
  await mockDiscord.send({
    op: 0,
    s: (seqBefore ?? 0) + 1,
    t: "PRESENCE_UPDATE",
    d: { user: { id: "u1" }, guild_id: "g1", status: "online", activities: [] },
  });
  await vi.waitFor(() => {
    const logged = logSpy.mock.calls.some(([line]) => String(line).includes('"message_error"'));
    expect(logged).toBe(true);
  }, POLL);
  expect(await seqNow()).toBe(seqBefore);
  expect(
    await runInDurableObject(botStub(env), (instance) =>
      instance.db
        .select()
        .from(presence_sessions)
        .where(eq(presence_sessions.guild_id, "g1"))
        .all(),
    ),
  ).toEqual([]);
  expect(await state()).toBe("connected");
  logSpy.mockRestore();
});
