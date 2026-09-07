import { env } from "cloudflare:workers";
import { vi } from "vitest";

export interface Frame {
  op: number;
  s?: number | null;
  t?: string | null;
  d?: unknown;
}

// MOCK only exists in vitest.config.ts's miniflare bindings (the mock Discord control plane),
// Not in wrangler.jsonc, so Cloudflare.Env does not type it.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see comment above.
const mock = (env as unknown as { MOCK: Fetcher }).MOCK,
  call = async (path: string, body?: unknown): Promise<Response> =>
    mock.fetch(
      `http://mock${path}`,
      body === undefined ? undefined : { method: "POST", body: JSON.stringify(body) },
    ),
  mockDiscord = {
    received: async (): Promise<Frame[]> => {
      const response = await call("/received");
      return response.json();
    },
    // How many times openGateway() has accepted a socket since the last reset() — a full
    // Reconnect bumps this even though received() alone cannot tell a reconnect from a no-op
    // (openGateway() always clears `received`).
    connections: async (): Promise<number> => {
      const response = await call("/connections");
      return response.json();
    },
    options: async (patch: Record<string, unknown>): Promise<Response> => call("/options", patch),
    // Server-initiated frames and closes: the mock became a Durable Object (wave 9), so these
    // Can now reach the socket a previous request accepted, unlike a stateless Worker.
    send: async (frame: Frame): Promise<Response> => call("/send", frame),
    close: async (code: number, reason = ""): Promise<Response> => call("/close", { code, reason }),
    reset: async (): Promise<Response> => call("/reset"),
  };

export { mockDiscord };

// Shared poll: 5 s timeout / 25 ms interval, matching gateway.spec.ts's own waitForState, so
// Reconnect.spec.ts can wait on any predicate without redeclaring vi.waitFor's options.
export async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  await vi.waitFor(
    async () => {
      if (!(await predicate())) {
        throw new Error("waitFor: condition not met");
      }
    },
    { timeout: 5000, interval: 25 },
  );
}
