import { ApplicationFlags, GatewayIntentBits } from "discord-api-types/v10";
import { describe, expect, test } from "vite-plus/test";

import { deriveIntents } from "../src/intents";

const privileged =
  GatewayIntentBits.GuildPresences |
  GatewayIntentBits.GuildMembers |
  GatewayIntentBits.MessageContent;

describe("Application の flag から intent を求める deriveIntents", () => {
  test("flag が無ければ、特権でない intent をすべて含み、特権 intent は含まない", () => {
    // Act
    const intents = deriveIntents(0);

    // Assert
    expect(intents & privileged).toBe(0);
    expect(intents).toBe(
      GatewayIntentBits.Guilds |
        GatewayIntentBits.GuildModeration |
        GatewayIntentBits.GuildExpressions |
        GatewayIntentBits.GuildIntegrations |
        GatewayIntentBits.GuildWebhooks |
        GatewayIntentBits.GuildInvites |
        GatewayIntentBits.GuildVoiceStates |
        GatewayIntentBits.GuildMessages |
        GatewayIntentBits.GuildMessageReactions |
        GatewayIntentBits.GuildMessageTyping |
        GatewayIntentBits.DirectMessages |
        GatewayIntentBits.DirectMessageReactions |
        GatewayIntentBits.DirectMessageTyping |
        GatewayIntentBits.GuildScheduledEvents |
        GatewayIntentBits.AutoModerationConfiguration |
        GatewayIntentBits.AutoModerationExecution |
        GatewayIntentBits.GuildMessagePolls |
        GatewayIntentBits.DirectMessagePolls,
    );
  });

  test.each([
    [ApplicationFlags.GatewayPresence, GatewayIntentBits.GuildPresences],
    [ApplicationFlags.GatewayPresenceLimited, GatewayIntentBits.GuildPresences],
    [ApplicationFlags.GatewayGuildMembers, GatewayIntentBits.GuildMembers],
    [ApplicationFlags.GatewayGuildMembersLimited, GatewayIntentBits.GuildMembers],
    [ApplicationFlags.GatewayMessageContent, GatewayIntentBits.MessageContent],
    [ApplicationFlags.GatewayMessageContentLimited, GatewayIntentBits.MessageContent],
  ])("flag %i は特権 intent %i だけを追加する", (flag, intent) => {
    // Act
    const intents = deriveIntents(flag);

    // Assert
    expect(intents & privileged).toBe(intent);
  });
});
