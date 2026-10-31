// Basin SQL の LIMIT の上限。これより多い行はページをたどって読む。
export const pageSize = 10_000;

export const requestTimeout = 60_000;

// Discord が PRESENCE_UPDATE で送る status。invisible の user も offline として届く。
export const presenceStatuses = ["online", "idle", "dnd", "offline"] as const;

// Activity の type のうち、ゲーム（Playing）。
export const gameActivityType = 0;

// Activity の type のうち、リスニング（Listening）。
export const listeningActivityType = 2;

// Activity の type のうち、配信（Streaming）。
export const streamingActivityType = 1;
