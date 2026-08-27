import { describe, expect, test } from "bun:test";

import { gatewayHttpUrl } from "../src/url";

describe("gatewayHttpUrl", () => {
  test("turns the wss URL from GET /gateway/bot into an https upgrade URL with our query", () => {
    expect(gatewayHttpUrl("wss://gateway.discord.gg")).toBe(
      "https://gateway.discord.gg/?v=10&encoding=json",
    );
  });

  test("replaces any query Discord put on resume_gateway_url", () => {
    expect(gatewayHttpUrl("wss://gateway-us-east1-b.discord.gg/?v=9&encoding=etf")).toBe(
      "https://gateway-us-east1-b.discord.gg/?v=10&encoding=json",
    );
  });

  test("maps ws:// to http:// for local mock gateways", () => {
    expect(gatewayHttpUrl("ws://localhost:8787/gateway")).toBe(
      "http://localhost:8787/gateway?v=10&encoding=json",
    );
  });
});
