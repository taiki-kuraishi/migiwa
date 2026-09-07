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

// Exported for callers that need to end a connection mid-test (reconnect.spec.ts), not only at
// ResetBot()'s end-of-test cleanup. BotObject's socket is a plain (non-hibernatable) WebSocket
// That only its own DO instance may touch (see mock-discord/worker.js for the same restriction
// From the other side). Left open, evictDurableObject() hangs draining a subrequest that never
// Completes. This close runs its own onClose() handler, which reschedules an alarm — a caller
// That also evicts must call this first, or that reschedule would undo the eviction's own cleanup.
export async function closeLiveSocket(): Promise<void> {
  await runInDurableObject(botStub(env), (instance) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test cleanup only, see WithSocket above.
    (instance as unknown as WithSocket).socket?.close();
  });
}

// Shared by gateway.spec.ts and scheduled.spec.ts: both leave a Durable Object instance and a
// Mock Discord connection behind that the next test must not inherit.
export async function resetBot(): Promise<void> {
  // Close before reset, not after: closing fires the mock's own close listener, which (on code
  // 1000/1001) flips `options.resumable` to false and, either way, records a close code. Reset
  // Must land after that settles, or a late close event from this test's own teardown would
  // Mutate the next test's fresh `options`/closeCodes instead of this test's now-discarded ones.
  await closeLiveSocket();
  await mockDiscord.reset();
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
