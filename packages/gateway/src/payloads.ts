import { Opcode } from "./opcodes";

export interface GatewayMessage {
  op: number;
  d: unknown;
  s: number | null;
  t: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// JSON.parse throws on malformed frames; null is already rejected as "not a gateway message".
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Binary frames are never expected because no transport compression is requested.
// Anything that is not a JSON object with a numeric op is dropped by the caller.
export function parseMessage(raw: unknown): GatewayMessage | null {
  if (typeof raw !== "string") {
    return null;
  }
  const parsed = parseJson(raw);
  if (!isRecord(parsed)) {
    return null;
  }
  const { op, d, s, t } = parsed;
  if (typeof op !== "number") {
    return null;
  }
  return {
    op,
    d,
    s: typeof s === "number" ? s : null,
    t: typeof t === "string" ? t : null,
  };
}

export function identifyPayload(token: string, intents: number): string {
  return JSON.stringify({
    op: Opcode.Identify,
    d: {
      token,
      intents,
      properties: { os: "cloudflare", browser: "migiwa", device: "migiwa" },
    },
  });
}

export function resumePayload(token: string, sessionId: string, seq: number): string {
  return JSON.stringify({
    op: Opcode.Resume,
    d: { token, session_id: sessionId, seq },
  });
}

export function heartbeatPayload(seq: number | null): string {
  return JSON.stringify({ op: Opcode.Heartbeat, d: seq });
}
