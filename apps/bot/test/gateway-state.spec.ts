import { guilds } from "@migiwa/db";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";

import { botStub } from "../src/bot-stub";
import {
  clearSession,
  initialGatewayStore,
  readGateway,
  recordReconnect,
  toStatusReport,
  withStatus,
  writeGateway,
} from "../src/gateway-state";

const DAY = 86_400_000;

test("a fresh store is stopped with nothing known", () => {
  const store = initialGatewayStore(1000);
  expect(store.status).toBe("stopped");
  expect(store.status_since).toBe(1000);
  expect(store.session_id).toBeNull();
  expect(store.seq).toBeNull();
  expect(store.reconnects).toEqual([]);
});

test("withStatus records when a connected session was lost", () => {
  const connected = withStatus(initialGatewayStore(0), "connected", null, 10),
    lost = withStatus(connected, "backoff", "close_1006", 20);
  expect(connected.status_since).toBe(10);
  expect(connected.disconnected_at).toBeNull();
  expect(lost.disconnected_at).toBe(20);
  expect(withStatus(lost, "backoff", "close_1006", 30)).toBe(lost);
});

test("clearSession forgets the session but keeps the budget", () => {
  const store = {
      ...initialGatewayStore(0),
      session_id: "s",
      seq: 5,
      resume_gateway_url: "wss://x",
      identify_remaining: 900,
    },
    cleared = clearSession(store);
  expect(cleared.session_id).toBeNull();
  expect(cleared.seq).toBeNull();
  expect(cleared.resume_gateway_url).toBeNull();
  expect(cleared.identify_remaining).toBe(900);
});

test("recordReconnect keeps only the last 24 hours", () => {
  const store = recordReconnect(recordReconnect(initialGatewayStore(0), 0), DAY + 1);
  expect(store.reconnects).toEqual([DAY + 1]);
});

test("toStatusReport counts reconnects within 24 hours", () => {
  const store = { ...initialGatewayStore(0), reconnects: [0, DAY, DAY + 5], seq: 7 },
    report = toStatusReport(store, 3, DAY + 10);
  expect(report).toEqual({
    state: "stopped",
    since: 0,
    reason: null,
    last_event_at: null,
    seq: 7,
    guild_count: 3,
    reconnects_24h: 2,
    identify_remaining: null,
  });
});

test("readGateway and writeGateway round-trip through the DO's synchronous kv", async () => {
  await runInDurableObject(botStub(env), (_instance, state) => {
    const store = withStatus(initialGatewayStore(1), "connected", null, 2);
    writeGateway(state.storage.kv, { ...store, session_id: "sess", seq: 3 });
    expect(readGateway(state.storage.kv, 99).session_id).toBe("sess");
    expect(readGateway(state.storage.kv, 99).seq).toBe(3);
    expect(readGateway(state.storage.kv, 99).status).toBe("connected");
  });
});

test("status() reports what the store says plus the available guild count", async () => {
  await runInDurableObject(botStub(env), (instance, state) => {
    writeGateway(state.storage.kv, withStatus(initialGatewayStore(0), "connected", null, 5));
    state.storage.sql.exec(
      "INSERT INTO guilds (guild_id, name, first_seen_at, available) VALUES ('g1', 'a', 0, 1), ('g2', 'b', 0, 0)",
    );
    expect(instance.db.select().from(guilds).all()).toHaveLength(2);
  });
  const report = await botStub(env).status();
  expect(report.state).toBe("connected");
  expect(report.since).toBe(5);
  expect(report.guild_count).toBe(1);
});
