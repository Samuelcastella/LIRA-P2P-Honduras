CREATE TABLE `otp_challenges` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`sessionId` varchar(36) NOT NULL,
	`otp_purpose` enum('transfer') NOT NULL,
	`codeHash` varchar(255) NOT NULL,
	`otp_challenge_status` enum('issued','verified','consumed','expired','locked') NOT NULL DEFAULT 'issued',
	`attempts` int NOT NULL DEFAULT 0,
	`expiresAt` timestamp NOT NULL,
	`verifiedAt` timestamp,
	`consumedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `otp_challenges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `security_sessions` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`deviceId` varchar(36) NOT NULL,
	`sessionFingerprintHash` varchar(64) NOT NULL,
	`label` varchar(100) NOT NULL,
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `security_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `security_session_user_fingerprint_unique` UNIQUE(`userId`,`sessionFingerprintHash`)
);
--> statement-breakpoint
CREATE TABLE `trusted_devices` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`fingerprintHash` varchar(64) NOT NULL,
	`label` varchar(100) NOT NULL,
	`platform` varchar(80) NOT NULL,
	`trustedAt` timestamp NOT NULL DEFAULT (now()),
	`lastUsedAt` timestamp NOT NULL DEFAULT (now()),
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `trusted_devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `trusted_device_user_fingerprint_unique` UNIQUE(`userId`,`fingerprintHash`)
);
--> statement-breakpoint
CREATE TABLE `user_security_profiles` (
	`userId` int NOT NULL,
	`pinHash` varchar(255),
	`failedPinAttempts` int NOT NULL DEFAULT 0,
	`lockedUntil` timestamp,
	`pinUpdatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_security_profiles_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
ALTER TABLE `otp_challenges` ADD CONSTRAINT `otp_challenges_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `otp_challenges` ADD CONSTRAINT `otp_challenges_sessionId_security_sessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `security_sessions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `security_sessions` ADD CONSTRAINT `security_sessions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `security_sessions` ADD CONSTRAINT `security_sessions_deviceId_trusted_devices_id_fk` FOREIGN KEY (`deviceId`) REFERENCES `trusted_devices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trusted_devices` ADD CONSTRAINT `trusted_devices_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_security_profiles` ADD CONSTRAINT `user_security_profiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `otp_challenge_user_idx` ON `otp_challenges` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `otp_challenge_session_idx` ON `otp_challenges` (`sessionId`,`otp_challenge_status`);--> statement-breakpoint
CREATE INDEX `security_session_user_idx` ON `security_sessions` (`userId`,`lastSeenAt`);--> statement-breakpoint
CREATE INDEX `trusted_device_user_idx` ON `trusted_devices` (`userId`,`lastUsedAt`);