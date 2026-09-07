import { env } from "cloudflare:workers";

export interface Frame {
  op: number;
  s?: number | null;
  t?: string | null;
  d?: unknown;
}

interface MockState {
  hosts: string[];
  closeCodes: number[];
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
  mockState = async (): Promise<MockState> => {
    const response = await call("/mock-state");
    return response.json();
  },
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
    // The host each openGateway() call upgraded, in order — lets a test constrain a RESUME to
    // Actually dial `resume_gateway_url` instead of the mock's single shared handler silently
    // Accepting a reconnect to the plain gateway host too. Close codes the mock's server-side
    // Socket has observed, in order (see openGateway()'s close listener in worker.js) — lets a
    // Test constrain which code the bot closed with (e.g. RECONNECT_CLOSE_CODE on a zombie)
    // Without the mock echoing it back on any frame. One control path for both: see worker.js's
    // Control() for why.
    hosts: async (): Promise<string[]> => {
      const snapshot = await mockState();
      return snapshot.hosts;
    },
    closeCodes: async (): Promise<number[]> => {
      const snapshot = await mockState();
      return snapshot.closeCodes;
    },
    options: async (patch: Record<string, unknown>): Promise<Response> => call("/options", patch),
    // Server-initiated frames and closes: the mock became a Durable Object (wave 9), so these
    // Can now reach the socket a previous request accepted, unlike a stateless Worker.
    send: async (frame: Frame): Promise<Response> => call("/send", frame),
    close: async (code: number, reason = ""): Promise<Response> => call("/close", { code, reason }),
    reset: async (): Promise<Response> => call("/reset"),
  };

export { mockDiscord };
