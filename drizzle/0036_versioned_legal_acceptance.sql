CREATE TABLE `legal_acceptances` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
	`terms_version` text NOT NULL,
	`privacy_policy_version` text NOT NULL,
	`notice_version` text NOT NULL,
	`acceptance_source` text DEFAULT 'onboarding_review' NOT NULL,
	`source_hash` text,
	`user_agent_hash` text,
	`request_id` text NOT NULL,
	`accepted_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_acceptances_user_versions_unique` ON `legal_acceptances` (`user_id`,`terms_version`,`privacy_policy_version`);
--> statement-breakpoint
CREATE INDEX `legal_acceptances_workspace_idx` ON `legal_acceptances` (`organization_id`,`accepted_at`);
