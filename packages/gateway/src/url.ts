const QUERY = "v=10&encoding=json";

// Discord hands out wss:// URLs, but the Workers upgrade path is fetch() with an https:// URL.
// The version and encoding are always ours: resume_gateway_url must be opened with the same parameters as the original connection.
export function gatewayHttpUrl(url: string): string {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === "ws:" ? "http:" : "https:";
  parsed.search = QUERY;
  return parsed.toString();
}
