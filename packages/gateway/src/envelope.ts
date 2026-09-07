import type { GatewayReceivePayload } from "discord-api-types/v10";

import { Result, TaggedError } from "better-result";

export type MalformedFrameReason =
  | "binary"
  | "invalid_json"
  | "not_object"
  | "bad_op"
  | "bad_s"
  | "bad_t";

// Why a frame was dropped before dispatch (spec §5.4, D12).
// The reason is what the ingest counters log; the payload itself never is.
// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError factory call, not a throw.
export class MalformedFrame extends TaggedError("MalformedFrame")<{
  reason: MalformedFrameReason;
  message: string;
}> {}

const malformed = (reason: MalformedFrameReason): Result<never, MalformedFrame> =>
  Result.err(new MalformedFrame({ reason, message: `gateway frame dropped: ${reason}` }));

// Envelope guard only (spec §5.4): `op`, `s` and `t` are checked.
// The `d` payload is trusted and later narrowed by `t` through discord-api-types.
// Discord is a trusted upstream; validating every GUILD_CREATE payload would burn CPU for nothing.
// Discord always sends all four envelope fields; `s` and `t` are simply null outside dispatches.
// A missing or malformed field here causes the frame to be dropped.
export function parseGatewayMessage(raw: unknown): Result<GatewayReceivePayload, MalformedFrame> {
  if (typeof raw !== "string") {
    return malformed("binary");
  }
  return Result.try({
    try: (): unknown => JSON.parse(raw),
    catch: () => new MalformedFrame({ reason: "invalid_json", message: "frame is not JSON" }),
  }).andThen((value) => {
    if (typeof value !== "object" || value === null) {
      return malformed("not_object");
    }
    const { op, s, t } = value as { op?: unknown; s?: unknown; t?: unknown };
    if (typeof op !== "number") {
      return malformed("bad_op");
    }
    if (s !== null && typeof s !== "number") {
      return malformed("bad_s");
    }
    if (t !== null && typeof t !== "string") {
      return malformed("bad_t");
    }
    // The `d` payload is deliberately not validated at runtime (spec §5.4).
    // Only the envelope (`op`, `s`, `t`) is checked above.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see comment above.
    return Result.ok(value as GatewayReceivePayload);
  });
}
