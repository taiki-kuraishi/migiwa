import type { GatewayOutput } from "@migiwa/gateway";

export type DispatchEvent = Extract<GatewayOutput, { type: "dispatch" }>["event"];
