export const GATEWAY_BOT_ENDPOINT = "https://discord.com/api/v10/gateway/bot";

// Workers open outbound WebSockets with fetch(), which wants an http(s) URL.
// Discord hands out wss:// URLs. Transport compression is deliberately not requested (spec §5.3).
export function gatewayHttpUrl(gatewayUrl: string): string {
  const url = new URL(gatewayUrl);
  url.protocol = url.protocol === "ws:" ? "http:" : "https:";
  url.search = "v=10&encoding=json";
  return url.toString();
}
