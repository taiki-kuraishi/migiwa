import { GatewayDispatchEvents } from "discord-api-types/v10";
import { describe, expect, test } from "vitest";

import { EventStreamClient } from "../src/client/event-stream-client";

describe("EventStreamClient の send", () => {
  test("10 秒以内に record を受け付けない stream は諦める", async () => {
    // Arrange
    const client = new EventStreamClient({
      stream: { send: async () => Promise.withResolvers<undefined>().promise },
    });

    // Act
    const sent = await client.send({
      receivedAt: 1000,
      event: {
        type: GatewayDispatchEvents.TypingStart,
        sequence: 2,
        sessionId: "session",
        data: { channel_id: "channel", user_id: "user", timestamp: 0 },
      },
    });

    // Assert
    expect(sent).toMatchObject({ error: { _tag: "EventSendError" } });
  });
});
