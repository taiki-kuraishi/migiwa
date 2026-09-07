CREATE TABLE `activity_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`activity_type` integer NOT NULL,
	`activity_key` text NOT NULL,
	`application_id` text,
	`name` text NOT NULL,
	`state` text,
	`details` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`end_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_sessions_open_uidx` ON `activity_sessions` (`guild_id`,`user_id`,`activity_type`,`activity_key`) WHERE "activity_sessions"."ended_at" IS NULL;--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`received_at` integer NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_guild_id_received_at_idx` ON `events` (`guild_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `events_type_received_at_idx` ON `events` (`type`,`received_at`);--> statement-breakpoint
CREATE TABLE `guilds` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`member_count` integer,
	`large` integer DEFAULT false NOT NULL,
	`available` integer DEFAULT true NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_snapshot_at` integer
);
--> statement-breakpoint
CREATE TABLE `presence_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`client_desktop` text,
	`client_mobile` text,
	`client_web` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`end_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `presence_sessions_open_uidx` ON `presence_sessions` (`guild_id`,`user_id`) WHERE "presence_sessions"."ended_at" IS NULL;--> statement-breakpoint
CREATE TABLE `voice_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`discord_session_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`end_reason` text,
	`self_mute` integer DEFAULT false NOT NULL,
	`self_deaf` integer DEFAULT false NOT NULL,
	`mute` integer DEFAULT false NOT NULL,
	`deaf` integer DEFAULT false NOT NULL,
	`self_stream` integer DEFAULT false NOT NULL,
	`self_video` integer DEFAULT false NOT NULL,
	`suppress` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_sessions_open_uidx` ON `voice_sessions` (`guild_id`,`user_id`) WHERE "voice_sessions"."ended_at" IS NULL;