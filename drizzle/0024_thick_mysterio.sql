CREATE TABLE `integration_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'accepted' NOT NULL,
	`notice_version` text NOT NULL,
	`privacy_policy_version` text NOT NULL,
	`data_categories_json` text NOT NULL,
	`purposes_json` text NOT NULL,
	`consent_source` text DEFAULT 'in_app' NOT NULL,
	`accepted_at` integer NOT NULL,
	`withdrawn_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "integration_consents_status_check" CHECK("integration_consents"."status" in ('accepted', 'withdrawn', 'expired')),
	CONSTRAINT "integration_consents_source_check" CHECK("integration_consents"."consent_source" in ('in_app'))
);
--> statement-breakpoint
CREATE INDEX `integration_consents_workspace_provider_status_idx` ON `integration_consents` (`organization_id`,`provider`,`status`,`accepted_at`);--> statement-breakpoint
CREATE INDEX `integration_consents_actor_idx` ON `integration_consents` (`actor_user_id`,`accepted_at`);--> statement-breakpoint
ALTER TABLE `integration_connections` ADD `privacy_data_deleted_at` integer;