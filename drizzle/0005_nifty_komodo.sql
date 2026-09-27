CREATE TABLE `daily_transfer_controls` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`periodStart` timestamp NOT NULL,
	`attemptedMinor` bigint NOT NULL DEFAULT 0,
	`attemptCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `daily_transfer_controls_id` PRIMARY KEY(`id`),
	CONSTRAINT `daily_transfer_control_user_period_unique` UNIQUE(`userId`,`periodStart`)
);
--> statement-breakpoint
ALTER TABLE `daily_transfer_controls` ADD CONSTRAINT `daily_transfer_controls_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `daily_transfer_control_user_idx` ON `daily_transfer_controls` (`userId`,`periodStart`);