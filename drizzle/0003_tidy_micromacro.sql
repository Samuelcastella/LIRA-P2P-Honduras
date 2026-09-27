CREATE TABLE `outbox_events` (
	`id` varchar(36) NOT NULL,
	`aggregateType` varchar(48) NOT NULL,
	`aggregateId` varchar(64) NOT NULL,
	`eventType` varchar(80) NOT NULL,
	`payloadHash` varchar(64) NOT NULL,
	`outbox_status` enum('pending','dispatched','failed') NOT NULL DEFAULT 'pending',
	`attemptCount` int NOT NULL DEFAULT 0,
	`availableAt` timestamp NOT NULL DEFAULT (now()),
	`dispatchedAt` timestamp,
	`failureCode` varchar(80),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `outbox_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `provider_webhook_events` (
	`id` varchar(36) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`providerEventId` varchar(96) NOT NULL,
	`eventType` varchar(80) NOT NULL,
	`transferReference` varchar(48) NOT NULL,
	`providerReference` varchar(96) NOT NULL,
	`sequence` int NOT NULL,
	`occurredAt` timestamp NOT NULL,
	`payloadHash` varchar(64) NOT NULL,
	`provider_webhook_status` enum('accepted','duplicate','rejected','ignored') NOT NULL,
	`reason` varchar(160),
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `provider_webhook_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `provider_webhook_event_unique` UNIQUE(`provider`,`providerEventId`)
);
--> statement-breakpoint
ALTER TABLE `payment_requests` ADD `canceledByUserId` int;--> statement-breakpoint
ALTER TABLE `payment_requests` ADD `canceledAt` timestamp;--> statement-breakpoint
ALTER TABLE `payment_requests` ADD CONSTRAINT `payment_request_transfer_unique` UNIQUE(`transferId`);--> statement-breakpoint
CREATE INDEX `outbox_pending_idx` ON `outbox_events` (`outbox_status`,`availableAt`);--> statement-breakpoint
CREATE INDEX `outbox_aggregate_idx` ON `outbox_events` (`aggregateType`,`aggregateId`);--> statement-breakpoint
CREATE INDEX `provider_webhook_transfer_idx` ON `provider_webhook_events` (`transferReference`,`receivedAt`);--> statement-breakpoint
ALTER TABLE `payment_requests` ADD CONSTRAINT `payment_requests_canceledByUserId_users_id_fk` FOREIGN KEY (`canceledByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;