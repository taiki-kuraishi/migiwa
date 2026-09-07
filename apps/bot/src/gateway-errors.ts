import { TaggedError } from "better-result";

// Every way connect() can fail before a socket is open (spec §5.3 step 4, D12).
// BotObject.onConnectError() matches on these exhaustively. `status` is null when the
// Request never got an answer (DNS, TLS, egress blocked).
// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError factory call, not a throw.
export class GatewayBotFailed extends TaggedError("GatewayBotFailed")<{
  status: number | null;
  message: string;
}> {}

// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError factory call, not a throw.
export class ShardingRequired extends TaggedError("ShardingRequired")<{
  shards: number;
  message: string;
}> {}

// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError factory call, not a throw.
export class IdentifyBudgetExhausted extends TaggedError("IdentifyBudgetExhausted")<{
  remaining: number;
  reset_after: number;
  message: string;
}> {}

// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError factory call, not a throw.
export class UpgradeFailed extends TaggedError("UpgradeFailed")<{
  status: number | null;
  message: string;
}> {}

export type ConnectError =
  | GatewayBotFailed
  | ShardingRequired
  | IdentifyBudgetExhausted
  | UpgradeFailed;
