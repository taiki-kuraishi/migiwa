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
