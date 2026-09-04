import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";

import { drizzle } from "drizzle-orm/durable-sqlite";

import * as schema from "./schemas";

// `storage` is ctx.storage, typed through drizzle's own signature.
// This package therefore needs no workers-types dependency; apps resolve `DurableObjectStorage` from their generated `worker-configuration.d.ts`.
export const createDatabaseClient = (storage: Parameters<typeof drizzle>[0]) =>
  drizzle(storage, { schema });

export type DatabaseClient = DrizzleSqliteDODatabase<typeof schema>;

// Row types selected from the schema, so consumers (sessionizer, MCP description) never hand-write a shape that drifts from it.
// `RawEvent`, not `Event`: the latter shadows the Workers / DOM global.
export type Guild = typeof schema.guilds.$inferSelect;
export type RawEvent = typeof schema.events.$inferSelect;
export type PresenceSession = typeof schema.presence_sessions.$inferSelect;
export type ActivitySession = typeof schema.activity_sessions.$inferSelect;
export type VoiceSession = typeof schema.voice_sessions.$inferSelect;
