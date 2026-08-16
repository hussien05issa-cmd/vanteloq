CREATE TABLE `assistant_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
	`title` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assistant_conversations_workspace_idx` ON `assistant_conversations` (`organization_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `assistant_conversations_user_idx` ON `assistant_conversations` (`user_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `assistant_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL REFERENCES `assistant_conversations`(`id`) ON DELETE CASCADE,
	`organization_id` text NOT NULL REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	`user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`model` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `assistant_messages_role_check` CHECK (`assistant_messages`.`role` in ('user','assistant'))
);
--> statement-breakpoint
CREATE INDEX `assistant_messages_conversation_idx` ON `assistant_messages` (`conversation_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `assistant_messages_workspace_idx` ON `assistant_messages` (`organization_id`,`created_at`);
