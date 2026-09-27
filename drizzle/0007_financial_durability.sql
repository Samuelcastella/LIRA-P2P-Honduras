ALTER TABLE `financial_accounts` MODIFY COLUMN `financial_account_type` enum('user_wallet','sandbox_clearing','reserve','provider_clearing','fees') NOT NULL;--> statement-breakpoint
ALTER TABLE `financial_accounts` ADD `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `transfers` MODIFY COLUMN `transfer_status` enum('created','authenticating','risk_review','authorized','processing','unknown','settled','declined','failed','canceled','reversed','expired') NOT NULL;--> statement-breakpoint
ALTER TABLE `transfers` ADD `unknownReason` varchar(160);--> statement-breakpoint
ALTER TABLE `transfers` ADD `settlementJournalId` varchar(36);--> statement-breakpoint
ALTER TABLE `transfers` ADD `reversalJournalId` varchar(36);--> statement-breakpoint
ALTER TABLE `transfers` ADD `providerSubmittedAt` timestamp;--> statement-breakpoint
ALTER TABLE `transfers` ADD `providerAcceptedAt` timestamp;--> statement-breakpoint
ALTER TABLE `transfers` ADD `unknownAt` timestamp;--> statement-breakpoint
ALTER TABLE `transfers` ADD `reversedAt` timestamp;--> statement-breakpoint
CREATE INDEX `transfer_provider_ref_idx` ON `transfers` (`providerReference`);--> statement-breakpoint
CREATE TABLE `fund_reservations` (
	`id` varchar(36) NOT NULL,
	`transferId` varchar(36) NOT NULL,
	`accountId` varchar(64) NOT NULL,
	`amountMinor` bigint NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'HNL',
	`hold_status` enum('active','captured','released','expired') NOT NULL DEFAULT 'active',
	`expiresAt` timestamp,
	`capturedAt` timestamp,
	`releasedAt` timestamp,
	`releaseReason` varchar(120),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fund_reservations_id` PRIMARY KEY(`id`),
	CONSTRAINT `fund_reservation_transfer_unique` UNIQUE(`transferId`)
);--> statement-breakpoint
ALTER TABLE `fund_reservations` ADD CONSTRAINT `fund_reservations_transferId_transfers_id_fk` FOREIGN KEY (`transferId`) REFERENCES `transfers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `fund_reservations` ADD CONSTRAINT `fund_reservations_accountId_financial_accounts_id_fk` FOREIGN KEY (`accountId`) REFERENCES `financial_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `fund_reservation_account_status_idx` ON `fund_reservations` (`accountId`,`hold_status`);--> statement-breakpoint
CREATE TABLE `journal_transactions` (
	`id` varchar(36) NOT NULL,
	`reference` varchar(64) NOT NULL,
	`transferId` varchar(36),
	`journal_type` enum('sandbox_seed','transfer_settlement','reversal','adjustment') NOT NULL,
	`journal_status` enum('posted') NOT NULL DEFAULT 'posted',
	`currency` varchar(3) NOT NULL DEFAULT 'HNL',
	`reversesJournalId` varchar(36),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`postedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `journal_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `journal_reference_unique` UNIQUE(`reference`)
);--> statement-breakpoint
ALTER TABLE `journal_transactions` ADD CONSTRAINT `journal_transactions_transferId_transfers_id_fk` FOREIGN KEY (`transferId`) REFERENCES `transfers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `journal_transfer_idx` ON `journal_transactions` (`transferId`);--> statement-breakpoint
CREATE INDEX `journal_reversal_idx` ON `journal_transactions` (`reversesJournalId`);--> statement-breakpoint
ALTER TABLE `ledger_entries` ADD `journalId` varchar(36);--> statement-breakpoint
INSERT IGNORE INTO `journal_transactions` (`id`, `reference`, `transferId`, `journal_type`, `journal_status`, `currency`, `createdAt`, `postedAt`)
SELECT `transferId`, CONCAT('MIG-', `transferId`), `transferId`, 'transfer_settlement', 'posted', MIN(`currency`), MIN(`createdAt`), MIN(`createdAt`)
FROM `ledger_entries`
GROUP BY `transferId`;--> statement-breakpoint
UPDATE `ledger_entries` SET `journalId` = `transferId` WHERE `journalId` IS NULL;--> statement-breakpoint
UPDATE `transfers` SET `settlementJournalId` = `id` WHERE `status` IN ('settled','reversed') AND `settlementJournalId` IS NULL AND EXISTS (SELECT 1 FROM `ledger_entries` WHERE `ledger_entries`.`transferId` = `transfers`.`id`);--> statement-breakpoint
ALTER TABLE `ledger_entries` MODIFY COLUMN `journalId` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `ledger_entries` MODIFY COLUMN `transferId` varchar(36);--> statement-breakpoint
ALTER TABLE `ledger_entries` DROP INDEX `ledger_transfer_account_direction_unique`;--> statement-breakpoint
ALTER TABLE `ledger_entries` ADD CONSTRAINT `ledger_entries_journalId_journal_transactions_id_fk` FOREIGN KEY (`journalId`) REFERENCES `journal_transactions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_journal_account_direction_unique` ON `ledger_entries` (`journalId`,`accountId`,`ledger_direction`);--> statement-breakpoint
CREATE INDEX `ledger_journal_idx` ON `ledger_entries` (`journalId`);--> statement-breakpoint
ALTER TABLE `audit_events` MODIFY COLUMN `requestId` varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE `reconciliation_items` ADD `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `outbox_events` MODIFY COLUMN `outbox_status` enum('pending','dispatching','dispatched','unknown','failed') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `outbox_events` ADD `claimedAt` timestamp;
