CREATE TABLE `game_intervals` (
	`user_id` text NOT NULL,
	`game_key` text NOT NULL,
	`application_id` text,
	`official_game_id` text,
	`name` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `game_key`, `started_at`)
);
--> statement-breakpoint
CREATE INDEX `game_intervals_ended_at_idx` ON `game_intervals` (`ended_at`);