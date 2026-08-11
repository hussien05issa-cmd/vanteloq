PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workspace_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`document_type` text NOT NULL,
	`file_name` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256_hex` text NOT NULL,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`scan_status` text DEFAULT 'pending' NOT NULL,
	`scanned_at` integer,
	`scan_provider` text,
	`extraction_status` text DEFAULT 'not_configured' NOT NULL,
	`extracted_json` text DEFAULT '{}' NOT NULL,
	`uploaded_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_documents_size_check" CHECK("__new_workspace_documents"."size_bytes" > 0 and "__new_workspace_documents"."size_bytes" <= 10485760),
	CONSTRAINT "workspace_documents_scan_status_check" CHECK("__new_workspace_documents"."scan_status" in ('pending', 'clean', 'blocked', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_workspace_documents`("id", "organization_id", "document_type", "file_name", "object_key", "content_type", "size_bytes", "sha256_hex", "status", "scan_status", "scanned_at", "scan_provider", "extraction_status", "extracted_json", "uploaded_by_user_id", "created_at", "updated_at") SELECT "id", "organization_id", "document_type", "file_name", "object_key", "content_type", "size_bytes", "sha256_hex", "status", 'pending', NULL, NULL, "extraction_status", "extracted_json", "uploaded_by_user_id", "created_at", "updated_at" FROM `workspace_documents`;--> statement-breakpoint
DROP TABLE `workspace_documents`;--> statement-breakpoint
ALTER TABLE `__new_workspace_documents` RENAME TO `workspace_documents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_documents_hash_unique` ON `workspace_documents` (`organization_id`,`sha256_hex`);--> statement-breakpoint
CREATE INDEX `workspace_documents_status_idx` ON `workspace_documents` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `workspace_documents_scan_idx` ON `workspace_documents` (`organization_id`,`scan_status`);
