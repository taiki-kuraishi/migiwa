import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";

import { botStub } from "../../src/bot-stub";
import { GATEWAY_KEY } from "../../src/gateway-state";
import { mockDiscord } from "./client";

// `BotObject.socket` is private to the class, but reaching into the live instance to close it
// Directly (below) is the only way to end a test's connection: it runs inside the DO's own
// Persistent actor context, same as a later RPC to that instance would, so it can touch a
// Socket a previous RPC opened — the exact pattern doConnect()'s own dropSocket() relies on.
interface WithSocket {
  socket: WebSocket | null;
}

// Shared by gateway.spec.ts and scheduled.spec.ts: both leave a Durable Object instance and a
// Mock Discord connection behind that the next test must not inherit.
export async function resetBot(): Promise<void> {
  await mockDiscord.reset();
  // BotObject's socket is a plain (non-hibernatable) WebSocket that only its own DO instance
  // May touch (see mock-discord/worker.js for the same restriction from the other side).
  // Left open, evictDurableObject() below hangs draining a subrequest that never completes.
  // This close runs its own onClose() handler, which reschedules an alarm — so it must happen
  // Before the cleanup below, not after, or that reschedule would undo the cleanup.
  await runInDurableObject(botStub(env), (instance) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test cleanup only, see WithSocket above.
    (instance as unknown as WithSocket).socket?.close();
  });
  // A pending alarm would re-create the object after eviction and reconnect to a reset mock;
  // A leftover session id would turn the next test's IDENTIFY into a RESUME.
  await runInDurableObject(botStub(env), async (_instance, ctx) => {
    ctx.storage.kv.delete(GATEWAY_KEY);
    return ctx.storage.deleteAlarm();
  });
  await evictDurableObject(botStub(env));
  // `onClose()` above runs on the socket's own async close event: if it lands after eviction,
  // Its scheduleReconnect() re-creates the KV entry and the alarm this cleanup just removed.
  // Repeating the deletion here closes that race regardless of which side won it.
  await runInDurableObject(botStub(env), async (_instance, ctx) => {
    ctx.storage.kv.delete(GATEWAY_KEY);
    return ctx.storage.deleteAlarm();
  });
}
