CREATE TABLE `streaming_intervals` (
	`user_id` text NOT NULL,
	`streaming_key` text NOT NULL,
	`url` text,
	`name` text NOT NULL,
	`details` text,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `streaming_key`, `started_at`)
);
--> statement-breakpoint
CREATE INDEX `streaming_intervals_ended_at_idx` ON `streaming_intervals` (`ended_at`);