import { describe, expect, test } from "bun:test";

import { gatewayHttpUrl } from "../src/url";

describe("gatewayHttpUrl", () => {
  test("turns wss into https and pins the query", () => {
    expect(gatewayHttpUrl("wss://gateway.discord.gg")).toBe(
      "https://gateway.discord.gg/?v=10&encoding=json",
    );
  });

  test("replaces whatever query the resume url carried", () => {
    expect(gatewayHttpUrl("wss://gateway-us-east1-b.discord.gg/?v=9")).toBe(
      "https://gateway-us-east1-b.discord.gg/?v=10&encoding=json",
    );
  });
});
