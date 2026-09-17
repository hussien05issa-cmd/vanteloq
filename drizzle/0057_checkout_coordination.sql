CREATE TABLE `billing_checkout_attempts` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`selection_key` text NOT NULL,
	`request_body` text NOT NULL,
	`session_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_checkout_attempts_attempt_id_unique` ON `billing_checkout_attempts` (`attempt_id`);--> statement-breakpoint
CREATE INDEX `rate_limit_expiry_idx` ON `rate_limit_buckets` (`expires_at`);