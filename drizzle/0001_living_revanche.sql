CREATE TABLE `audit_events` (
	`id` varchar(36) NOT NULL,
	`actorUserId` int,
	`audit_actor_type` enum('user','admin','system','provider') NOT NULL,
	`action` varchar(120) NOT NULL,
	`resource` varchar(80) NOT NULL,
	`resourceId` varchar(80) NOT NULL,
	`requestId` varchar(64) NOT NULL,
	`metadataHash` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bank_accounts` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`provider` varchar(64) NOT NULL,
	`externalAccountId` varchar(128) NOT NULL,
	`displayName` varchar(120) NOT NULL,
	`lastFour` varchar(4) NOT NULL,
	`bank_account_status` enum('linked','suspended','unlinked') NOT NULL DEFAULT 'linked',
	`tokenReference` varchar(160) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bank_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `bank_account_provider_external_unique` UNIQUE(`provider`,`externalAccountId`)
);
--> statement-breakpoint
CREATE TABLE `financial_accounts` (
	`id` varchar(64) NOT NULL,
	`userId` int,
	`bankAccountId` varchar(36),
	`financial_account_type` enum('user_wallet','sandbox_clearing','reserve') NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'HNL',
	`financial_account_status` enum('active','frozen','closed') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `financial_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` varchar(36) NOT NULL,
	`transferId` varchar(36) NOT NULL,
	`accountId` varchar(64) NOT NULL,
	`ledger_direction` enum('debit','credit') NOT NULL,
	`amountMinor` bigint NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'HNL',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ledger_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `ledger_transfer_account_direction_unique` UNIQUE(`transferId`,`accountId`,`ledger_direction`)
);
--> statement-breakpoint
CREATE TABLE `operational_controls` (
	`control` varchar(64) NOT NULL,
	`enabled` int NOT NULL DEFAULT 1,
	`reason` varchar(180) NOT NULL,
	`changedByUserId` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `operational_controls_control` PRIMARY KEY(`control`)
);
--> statement-breakpoint
CREATE TABLE `payment_requests` (
	`id` varchar(36) NOT NULL,
	`requesterUserId` int NOT NULL,
	`recipientHandle` varchar(80) NOT NULL,
	`amountMinor` bigint NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'HNL',
	`note` varchar(140),
	`payment_request_status` enum('open','paid','declined','canceled','expired') NOT NULL DEFAULT 'open',
	`transferId` varchar(36),
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payment_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reconciliation_items` (
	`id` varchar(36) NOT NULL,
	`transferId` varchar(36) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`providerReference` varchar(96) NOT NULL,
	`expectedAmountMinor` bigint NOT NULL,
	`reportedAmountMinor` bigint,
	`reconciliation_status` enum('match','status_mismatch','amount_mismatch','missing_internal','missing_external','duplicate_external','unknown') NOT NULL,
	`investigatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reconciliation_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `reconciliation_transfer_unique` UNIQUE(`transferId`)
);
--> statement-breakpoint
CREATE TABLE `risk_events` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`transferId` varchar(36) NOT NULL,
	`rule` varchar(120) NOT NULL,
	`score` int NOT NULL,
	`risk_severity` enum('low','medium','high') NOT NULL,
	`risk_event_decision` enum('allow','challenge','review','block') NOT NULL,
	`policyVersion` varchar(40) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `risk_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `transfers` (
	`id` varchar(36) NOT NULL,
	`reference` varchar(48) NOT NULL,
	`senderUserId` int NOT NULL,
	`recipientUserId` int,
	`recipientHandle` varchar(80) NOT NULL,
	`sourceAccountId` varchar(64) NOT NULL,
	`destinationAccountId` varchar(64) NOT NULL,
	`amountMinor` bigint NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'HNL',
	`transfer_status` enum('created','authenticating','risk_review','authorized','processing','settled','declined','failed','canceled','reversed','expired') NOT NULL,
	`risk_decision` enum('allow','challenge','review','block') NOT NULL,
	`idempotencyKey` varchar(128) NOT NULL,
	`requestFingerprint` varchar(64) NOT NULL,
	`providerReference` varchar(96),
	`failureCode` varchar(80),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`authorizedAt` timestamp,
	`settledAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `transfers_id` PRIMARY KEY(`id`),
	CONSTRAINT `transfer_reference_unique` UNIQUE(`reference`),
	CONSTRAINT `transfer_sender_idempotency_unique` UNIQUE(`senderUserId`,`idempotencyKey`)
);
--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bank_accounts` ADD CONSTRAINT `bank_accounts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `financial_accounts` ADD CONSTRAINT `financial_accounts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `financial_accounts` ADD CONSTRAINT `financial_accounts_bankAccountId_bank_accounts_id_fk` FOREIGN KEY (`bankAccountId`) REFERENCES `bank_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ledger_entries` ADD CONSTRAINT `ledger_entries_transferId_transfers_id_fk` FOREIGN KEY (`transferId`) REFERENCES `transfers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ledger_entries` ADD CONSTRAINT `ledger_entries_accountId_financial_accounts_id_fk` FOREIGN KEY (`accountId`) REFERENCES `financial_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operational_controls` ADD CONSTRAINT `operational_controls_changedByUserId_users_id_fk` FOREIGN KEY (`changedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_requests` ADD CONSTRAINT `payment_requests_requesterUserId_users_id_fk` FOREIGN KEY (`requesterUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_requests` ADD CONSTRAINT `payment_requests_transferId_transfers_id_fk` FOREIGN KEY (`transferId`) REFERENCES `transfers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reconciliation_items` ADD CONSTRAINT `reconciliation_items_transferId_transfers_id_fk` FOREIGN KEY (`transferId`) REFERENCES `transfers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `risk_events` ADD CONSTRAINT `risk_events_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `risk_events` ADD CONSTRAINT `risk_events_transferId_transfers_id_fk` FOREIGN KEY (`transferId`) REFERENCES `transfers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_senderUserId_users_id_fk` FOREIGN KEY (`senderUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_recipientUserId_users_id_fk` FOREIGN KEY (`recipientUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_sourceAccountId_financial_accounts_id_fk` FOREIGN KEY (`sourceAccountId`) REFERENCES `financial_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_destinationAccountId_financial_accounts_id_fk` FOREIGN KEY (`destinationAccountId`) REFERENCES `financial_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_resource_idx` ON `audit_events` (`resource`,`resourceId`);--> statement-breakpoint
CREATE INDEX `audit_actor_created_idx` ON `audit_events` (`actorUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `bank_account_user_idx` ON `bank_accounts` (`userId`);--> statement-breakpoint
CREATE INDEX `financial_account_user_idx` ON `financial_accounts` (`userId`);--> statement-breakpoint
CREATE INDEX `financial_account_bank_idx` ON `financial_accounts` (`bankAccountId`);--> statement-breakpoint
CREATE INDEX `ledger_account_created_idx` ON `ledger_entries` (`accountId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `ledger_transfer_idx` ON `ledger_entries` (`transferId`);--> statement-breakpoint
CREATE INDEX `payment_request_requester_idx` ON `payment_requests` (`requesterUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `payment_request_status_idx` ON `payment_requests` (`payment_request_status`);--> statement-breakpoint
CREATE INDEX `reconciliation_status_idx` ON `reconciliation_items` (`reconciliation_status`);--> statement-breakpoint
CREATE INDEX `risk_transfer_idx` ON `risk_events` (`transferId`);--> statement-breakpoint
CREATE INDEX `risk_user_created_idx` ON `risk_events` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `transfer_sender_created_idx` ON `transfers` (`senderUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `transfer_recipient_created_idx` ON `transfers` (`recipientUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `transfer_status_idx` ON `transfers` (`transfer_status`);