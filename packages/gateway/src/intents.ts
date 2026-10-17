import { ApplicationFlags, GatewayIntentBits } from "discord-api-types/v10";

// Enum から集めず手で並べる。library が後で足す intent は特権かもしれず、承認なしに
// IDENTIFY すると 4014 で接続が閉じられる。
const nonPrivilegedIntents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildExpressions,
  GatewayIntentBits.GuildIntegrations,
  GatewayIntentBits.GuildWebhooks,
  GatewayIntentBits.GuildInvites,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildMessageTyping,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.DirectMessageReactions,
  GatewayIntentBits.DirectMessageTyping,
  GatewayIntentBits.GuildScheduledEvents,
  GatewayIntentBits.AutoModerationConfiguration,
  GatewayIntentBits.AutoModerationExecution,
  GatewayIntentBits.GuildMessagePolls,
  GatewayIntentBits.DirectMessagePolls,
];

// Application flags の bit は intent の bit と揃っていない（GatewayGuildMembersLimited は 1 << 15 で、
// MESSAGE_CONTENT intent と同じ bit）ので、特権 intent はこの対応表を通してだけ足す。
const privilegedIntents = [
  {
    intent: GatewayIntentBits.GuildPresences,
    grantedBy: ApplicationFlags.GatewayPresence | ApplicationFlags.GatewayPresenceLimited,
  },
  {
    intent: GatewayIntentBits.GuildMembers,
    grantedBy: ApplicationFlags.GatewayGuildMembers | ApplicationFlags.GatewayGuildMembersLimited,
  },
  {
    intent: GatewayIntentBits.MessageContent,
    grantedBy:
      ApplicationFlags.GatewayMessageContent | ApplicationFlags.GatewayMessageContentLimited,
  },
];

/**
 * Application の flags（bot Worker が GET /applications/@me で取る）から、IDENTIFY で送る intents を
 * 導出する。
 * 1. 非特権の intent をすべて入れる
 * 2. 特権の intent は、対応する flag（*_LIMITED を含む）が有効なものだけを足す
 */
export const deriveIntents = (applicationFlags: number) => {
  let intents = 0;
  // Step 1: 非特権の intent をすべて入れる
  for (const intent of nonPrivilegedIntents) {
    intents |= intent;
  }

  // Step 2: 特権の intent は、対応する flag（*_LIMITED を含む）が有効なものだけを足す
  for (const { intent, grantedBy } of privilegedIntents) {
    if ((applicationFlags & grantedBy) !== 0) {
      intents |= intent;
    }
  }
  return intents;
};
