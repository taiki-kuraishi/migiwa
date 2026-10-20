CREATE TABLE `presence_intervals` (
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `started_at`)
);
--> statement-breakpoint
CREATE INDEX `presence_intervals_ended_at_idx` ON `presence_intervals` (`ended_at`);