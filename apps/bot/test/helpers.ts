import type { GatewayState } from "@migiwa/gateway";

import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, vi } from "vitest";

import { botStub } from "../src/bot-stub";
import { readGateway } from "../src/gateway-state";
import { mockDiscord } from "./mock-discord/client";

// Shared by gateway.spec.ts and reconnect.spec.ts: workerd start-up plus cross-worker (mock
// Discord) round-trips both need more headroom than vitest's own polling default.
export const POLL = { timeout: 5000, interval: 25 },
  state = async (): Promise<GatewayState> => {
    const report = await botStub(env).status();
    return report.state;
  },
  store = async () =>
    runInDurableObject(botStub(env), (_instance, ctx) => readGateway(ctx.storage.kv, Date.now())),
  waitForState = async (want: GatewayState): Promise<void> =>
    vi.waitFor(async () => expect(await state()).toBe(want), POLL),
  // One op filter shared by every received()-based assertion; resumes/identifies below keep call
  // Sites reading the way they did before this was a one-liner.
  framesWithOp = (op: number) => async () => {
    const frames = await mockDiscord.received();
    return frames.filter((frame) => frame.op === op);
  },
  resumes = framesWithOp(6),
  identifies = framesWithOp(2);

export async function connectAndWait(): Promise<void> {
  await botStub(env).ensureConnected();
  await waitForState("connected");
}
