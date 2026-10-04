CREATE TABLE `onboarding_drafts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`draft_json` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "onboarding_draft_json" CHECK(json_valid("onboarding_drafts"."draft_json")),
	CONSTRAINT "onboarding_draft_revision" CHECK("onboarding_drafts"."revision">=1)
);
--> statement-breakpoint
CREATE INDEX `onboarding_drafts_expiry_idx` ON `onboarding_drafts` (`expires_at`);--> statement-breakpoint
CREATE TABLE `workspace_industry_config` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`industry_label` text NOT NULL,
	`config_json` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "workspace_industry_config_json" CHECK(json_valid("workspace_industry_config"."config_json")),
	CONSTRAINT "workspace_industry_revision" CHECK("workspace_industry_config"."revision">=1)
);
--> statement-breakpoint
CREATE TABLE `workspace_industry_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` text NOT NULL,
	`industry_label` text NOT NULL,
	`config_json` text NOT NULL,
	`revision` integer NOT NULL,
	`changed_by` text,
	`changed_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "workspace_industry_history_json" CHECK(json_valid("workspace_industry_history"."config_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_industry_history_revision` ON `workspace_industry_history` (`organization_id`,`revision`);
--> statement-breakpoint
CREATE TRIGGER workspace_industry_insert AFTER INSERT ON workspace_industry_config BEGIN
 UPDATE workspaces SET industry=NEW.industry_label, updated_at=NEW.updated_at WHERE id=NEW.organization_id;
 INSERT INTO workspace_industry_history(organization_id,industry_label,config_json,revision,changed_by,changed_at)
 VALUES(NEW.organization_id,NEW.industry_label,NEW.config_json,NEW.revision,NEW.updated_by,NEW.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER workspace_industry_update AFTER UPDATE ON workspace_industry_config BEGIN
 UPDATE workspaces SET industry=NEW.industry_label, updated_at=NEW.updated_at WHERE id=NEW.organization_id;
 INSERT INTO workspace_industry_history(organization_id,industry_label,config_json,revision,changed_by,changed_at)
 VALUES(NEW.organization_id,NEW.industry_label,NEW.config_json,NEW.revision,NEW.updated_by,NEW.updated_at);
END;
