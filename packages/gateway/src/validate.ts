import type { GatewayDispatchPayload } from "discord-api-types/v10";

import { Result, TaggedError } from "better-result";
import typia from "typia";

import type {
  GatewayBotSlice,
  GuildCreateSlice,
  GuildDeleteSlice,
  HelloSlice,
  PresenceSlice,
  ReadySlice,
  VoiceStateSlice,
} from "./slices";

// What BotObject.onDispatch() receives: `d` already checked against its slice.
// RESUMED and OTHER carry no `d` to check.
export type ValidatedDispatch =
  | { t: "READY"; s: number; d: ReadySlice }
  | { t: "RESUMED"; s: number }
  | { t: "GUILD_CREATE"; s: number; d: GuildCreateSlice }
  | { t: "GUILD_DELETE"; s: number; d: GuildDeleteSlice }
  | { t: "PRESENCE_UPDATE"; s: number; d: PresenceSlice }
  | { t: "VOICE_STATE_UPDATE"; s: number; d: VoiceStateSlice }
  | { t: "OTHER"; s: number; name: string };

// `path` / `expected` come from typia (e.g. "$input.user.id", "string").
// The offending value is never carried, so it can't leak into a log (spec §9).
// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError factory call, not a throw.
export class MalformedPayload extends TaggedError("MalformedPayload")<{
  what: string;
  path: string;
  expected: string;
  message: string;
}> {}

// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError factory call, not a throw.
export class MalformedDispatch extends TaggedError("MalformedDispatch")<{
  event: string;
  path: string;
  expected: string;
  message: string;
}> {}

const firstError = (errors: typia.IValidation.IError[]): { path: string; expected: string } =>
    errors[0] ?? { path: "$input", expected: "unknown" },
  checked = <T>(what: string, validation: typia.IValidation<T>): Result<T, MalformedPayload> => {
    if (validation.success) {
      return Result.ok(validation.data);
    }
    const { path, expected } = firstError(validation.errors);
    return Result.err(
      new MalformedPayload({
        what,
        path,
        expected,
        message: `${what}: ${path} should be ${expected}`,
      }),
    );
  },
  // Every typia.validate<T>() call is written out at its own site.
  // A generic helper would have nothing to expand, since ttsc generates one validator per call site.
  validateHello = (d: unknown): Result<HelloSlice, MalformedPayload> =>
    checked("HELLO", typia.validate<HelloSlice>(d)),
  validateGatewayBotInfo = (input: unknown): Result<GatewayBotSlice, MalformedPayload> =>
    checked("GET /gateway/bot", typia.validate<GatewayBotSlice>(input));

export { validateGatewayBotInfo, validateHello };

export function validateDispatch(
  message: GatewayDispatchPayload,
): Result<ValidatedDispatch, MalformedDispatch> {
  const { s } = message,
    event: string = message.t,
    d: unknown = message.d,
    wrap = <T>(validation: typia.IValidation<T>): Result<T, MalformedDispatch> =>
      checked(event, validation).mapError(
        (error) =>
          new MalformedDispatch({
            event,
            path: error.path,
            expected: error.expected,
            message: error.message,
          }),
      );
  switch (event) {
    case "READY": {
      return wrap(typia.validate<ReadySlice>(d)).map((data): ValidatedDispatch => ({
        t: "READY",
        s,
        d: data,
      }));
    }
    case "RESUMED": {
      return Result.ok({ t: "RESUMED", s });
    }
    case "GUILD_CREATE": {
      return wrap(typia.validate<GuildCreateSlice>(d)).map((data): ValidatedDispatch => ({
        t: "GUILD_CREATE",
        s,
        d: data,
      }));
    }
    case "GUILD_DELETE": {
      return wrap(typia.validate<GuildDeleteSlice>(d)).map((data): ValidatedDispatch => ({
        t: "GUILD_DELETE",
        s,
        d: data,
      }));
    }
    case "PRESENCE_UPDATE": {
      return wrap(typia.validate<PresenceSlice>(d)).map((data): ValidatedDispatch => ({
        t: "PRESENCE_UPDATE",
        s,
        d: data,
      }));
    }
    case "VOICE_STATE_UPDATE": {
      return wrap(typia.validate<VoiceStateSlice>(d)).map((data): ValidatedDispatch => ({
        t: "VOICE_STATE_UPDATE",
        s,
        d: data,
      }));
    }
    default: {
      return Result.ok({ t: "OTHER", s, name: event });
    }
  }
}
