CREATE TABLE `listening_intervals` (
	`user_id` text NOT NULL,
	`listening_key` text NOT NULL,
	`sync_id` text,
	`name` text NOT NULL,
	`details` text,
	`state` text,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `listening_key`, `started_at`)
);
--> statement-breakpoint
CREATE INDEX `listening_intervals_ended_at_idx` ON `listening_intervals` (`ended_at`);