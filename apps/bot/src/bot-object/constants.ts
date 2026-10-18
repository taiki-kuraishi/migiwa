// Open できなかった socket や error で切れた socket には close code が無い。異常切断の 1006 として
// GatewayClient に渡し、RESUME で繋ぎ直させる。
export const abnormalCloseCode = 1006;

// 1000・1001 以外で閉じると、Discord は session を残して RESUME を受け付ける。
export const resumableCloseCode = 4000;

// Discord は Upgrade の直後に HELLO を送るので、5 秒届かない socket は見限ってよい。
export const helloTimeout = 5000;
