ALTER TABLE `trusted_devices` ADD `device_trust_status` enum('new','pending','trusted','restricted','revoked') NOT NULL DEFAULT 'new';--> statement-breakpoint
ALTER TABLE `trusted_devices` ADD `enrollmentRequestedAt` timestamp NOT NULL DEFAULT (now());--> statement-breakpoint
ALTER TABLE `trusted_devices` ADD `eligibleAt` timestamp;--> statement-breakpoint
ALTER TABLE `trusted_devices` MODIFY COLUMN `trustedAt` timestamp NULL;--> statement-breakpoint
ALTER TABLE `trusted_devices` ADD `trustMethod` varchar(80);--> statement-breakpoint
ALTER TABLE `trusted_devices` ADD `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
UPDATE `trusted_devices`
SET
  `device_trust_status` = CASE WHEN `revokedAt` IS NULL THEN 'new' ELSE 'revoked' END,
  `enrollmentRequestedAt` = `createdAt`,
  `eligibleAt` = DATE_ADD(`createdAt`, INTERVAL 1 HOUR),
  `trustedAt` = NULL,
  `trustMethod` = NULL;--> statement-breakpoint
CREATE INDEX `trusted_device_status_idx` ON `trusted_devices` (`userId`,`device_trust_status`);--> statement-breakpoint
ALTER TABLE `security_sessions` ADD `authStrength` varchar(32) NOT NULL DEFAULT 'basic';--> statement-breakpoint
ALTER TABLE `security_sessions` ADD `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `otp_challenges` MODIFY COLUMN `otp_purpose` enum('transfer','device_enrollment') NOT NULL;
