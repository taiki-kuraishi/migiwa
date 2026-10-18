import type { GatewayClient } from "./gateway-client";

export interface GatewayState {
  sessionId: string | null;
  sequence: number | null;
  resumeUrl: string | null;
  gatewayUrl: string;
}

// Heartbeat の間隔と ACK は 1 本の socket にだけ属するので、1 つの object にまとめて socket ごとに
// 作り直す。class の属性に分けると、前の socket の acked を新しい socket で読み違えうる。
export interface Connection {
  heartbeatInterval: number | null;
  acked: boolean;
}

// Durable Object が実行する出力。入力 method の戻り値から導出し、出力を足しても手で直さずに済むようにする。
export type GatewayOutput = ReturnType<
  GatewayClient["start" | "connected" | "received" | "disconnected" | "heartbeatDue"]
>[number];
