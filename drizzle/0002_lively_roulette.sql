ALTER TABLE `payment_requests` ADD `idempotencyKey` varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_requests` ADD `requestFingerprint` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_requests` ADD CONSTRAINT `payment_request_requester_idempotency_unique` UNIQUE(`requesterUserId`,`idempotencyKey`);