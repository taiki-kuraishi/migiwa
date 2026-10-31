CREATE TABLE `custom_status_intervals` (
	`user_id` text NOT NULL,
	`state` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `state`, `started_at`)
);
--> statement-breakpoint
CREATE INDEX `custom_status_intervals_ended_at_idx` ON `custom_status_intervals` (`ended_at`);