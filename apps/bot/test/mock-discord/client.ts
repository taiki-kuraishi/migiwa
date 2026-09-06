import { env } from "cloudflare:workers";

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
    options: async (patch: Record<string, unknown>): Promise<Response> => call("/options", patch),
    send: async (frame: Frame): Promise<Response> => call("/send", frame),
    close: async (code: number, reason = ""): Promise<Response> => call("/close", { code, reason }),
    reset: async (): Promise<Response> => call("/reset"),
  };

export { mockDiscord };

export async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // oxlint-disable-next-line no-await-in-loop -- polling is the point here.
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: timed out");
    }
    // oxlint-disable-next-line no-await-in-loop -- polling is the point here.
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
