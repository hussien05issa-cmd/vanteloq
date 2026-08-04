CREATE TABLE `access_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#53657a' NOT NULL,
	`system_key` text,
	`permissions_json` text DEFAULT '[]' NOT NULL,
	`location_scope_json` text DEFAULT '[]' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_roles_name_unique` ON `access_roles` (`organization_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `access_roles_system_unique` ON `access_roles` (`organization_id`,`system_key`);--> statement-breakpoint
CREATE INDEX `access_roles_workspace_idx` ON `access_roles` (`organization_id`,`archived`);--> statement-breakpoint
CREATE TABLE `employee_pin_credentials` (
	`member_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`salt_hex` text NOT NULL,
	`hash_hex` text NOT NULL,
	`iterations` integer DEFAULT 210000 NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`expires_at` integer NOT NULL,
	`force_change` integer DEFAULT true NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `team_members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "employee_pin_iterations_check" CHECK("employee_pin_credentials"."iterations" >= 100000),
	CONSTRAINT "employee_pin_failures_check" CHECK("employee_pin_credentials"."failed_attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX `employee_pin_workspace_idx` ON `employee_pin_credentials` (`organization_id`);--> statement-breakpoint
CREATE TABLE `goods_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`purchase_order_id` text NOT NULL,
	`received_date` text NOT NULL,
	`received_by_user_id` text NOT NULL,
	`lines_json` text NOT NULL,
	`discrepancy_status` text DEFAULT 'matched' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`received_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `goods_receipts_po_idx` ON `goods_receipts` (`organization_id`,`purchase_order_id`);--> statement-breakpoint
CREATE TABLE `invoice_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`purchase_order_id` text NOT NULL,
	`document_id` text NOT NULL,
	`status` text NOT NULL,
	`difference_cents` integer DEFAULT 0 NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`reviewed_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `workspace_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_matches_document_unique` ON `invoice_matches` (`organization_id`,`document_id`);--> statement-breakpoint
CREATE INDEX `invoice_matches_po_idx` ON `invoice_matches` (`organization_id`,`purchase_order_id`);--> statement-breakpoint
CREATE TABLE `organization_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`country_code` text NOT NULL,
	`address_line_1` text NOT NULL,
	`address_line_2` text DEFAULT '' NOT NULL,
	`address_line_3` text DEFAULT '' NOT NULL,
	`locality` text NOT NULL,
	`district` text DEFAULT '' NOT NULL,
	`administrative_area` text NOT NULL,
	`postal_code` text DEFAULT '' NOT NULL,
	`timezone` text NOT NULL,
	`currency` text NOT NULL,
	`locale` text DEFAULT 'en-CA' NOT NULL,
	`tax_jurisdiction` text DEFAULT '' NOT NULL,
	`validation_status` text DEFAULT 'entered' NOT NULL,
	`latitude_e6` integer,
	`longitude_e6` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_locations_status_check" CHECK("organization_locations"."status" in ('active', 'archived')),
	CONSTRAINT "organization_locations_validation_check" CHECK("organization_locations"."validation_status" in ('entered', 'suggested', 'validated'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_locations_name_unique` ON `organization_locations` (`organization_id`,`name`);--> statement-breakpoint
CREATE INDEX `organization_locations_status_idx` ON `organization_locations` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `organization_profiles` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`organization_type` text DEFAULT 'business' NOT NULL,
	`business_structure` text DEFAULT '' NOT NULL,
	`locale` text DEFAULT 'en-CA' NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`brand_color` text DEFAULT '#2368c4' NOT NULL,
	`logo_object_key` text,
	`logo_content_type` text,
	`logo_alt_text` text DEFAULT 'Organization logo' NOT NULL,
	`logo_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_profiles_logo_version_check" CHECK("organization_profiles"."logo_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE `purchase_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`purchase_order_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`sku` text DEFAULT '' NOT NULL,
	`description` text NOT NULL,
	`quantity` integer NOT NULL,
	`received_quantity` integer DEFAULT 0 NOT NULL,
	`invoiced_quantity` integer DEFAULT 0 NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`previous_cost_cents` integer,
	`landed_cost_cents` integer,
	`current_inventory` integer,
	`reorder_point` integer,
	`forecast_demand` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "purchase_order_lines_quantity_check" CHECK("purchase_order_lines"."quantity" > 0 and "purchase_order_lines"."received_quantity" >= 0 and "purchase_order_lines"."invoiced_quantity" >= 0),
	CONSTRAINT "purchase_order_lines_cost_check" CHECK("purchase_order_lines"."unit_cost_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_order_lines_number_unique` ON `purchase_order_lines` (`purchase_order_id`,`line_number`);--> statement-breakpoint
CREATE INDEX `purchase_order_lines_workspace_idx` ON `purchase_order_lines` (`organization_id`,`purchase_order_id`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`order_number` text NOT NULL,
	`supplier_name` text NOT NULL,
	`delivery_location_id` text,
	`order_date` text NOT NULL,
	`expected_delivery_date` text,
	`currency` text NOT NULL,
	`payment_terms` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`discount_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`committed_cash_date` text,
	`notes` text DEFAULT '' NOT NULL,
	`approved_by_user_id` text,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`delivery_location_id`) REFERENCES `organization_locations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchase_orders_money_check" CHECK("purchase_orders"."subtotal_cents" >= 0 and "purchase_orders"."tax_cents" >= 0 and "purchase_orders"."discount_cents" >= 0 and "purchase_orders"."total_cents" = "purchase_orders"."subtotal_cents" + "purchase_orders"."tax_cents" - "purchase_orders"."discount_cents")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_number_unique` ON `purchase_orders` (`organization_id`,`order_number`);--> statement-breakpoint
CREATE INDEX `purchase_orders_status_idx` ON `purchase_orders` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text,
	`role_id` text,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`preferred_name` text DEFAULT '' NOT NULL,
	`email` text NOT NULL,
	`mobile` text DEFAULT '' NOT NULL,
	`employee_code` text NOT NULL,
	`job_title` text DEFAULT '' NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`employment_type` text DEFAULT 'employee' NOT NULL,
	`start_date` text,
	`end_date` text,
	`manager_member_id` text,
	`primary_location_id` text,
	`permitted_locations_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`remote_login` integer DEFAULT false NOT NULL,
	`require_mfa` integer DEFAULT false NOT NULL,
	`pin_enabled` integer DEFAULT false NOT NULL,
	`invitation_sent_at` integer,
	`invitation_expires_at` integer,
	`last_login_at` integer,
	`notes` text DEFAULT '' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`role_id`) REFERENCES `access_roles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`primary_location_id`) REFERENCES `organization_locations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "team_members_status_check" CHECK("team_members"."status" in ('draft', 'invited', 'invitation_expired', 'pending_verification', 'active', 'suspended', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_email_unique` ON `team_members` (`organization_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_code_unique` ON `team_members` (`organization_id`,`employee_code`);--> statement-breakpoint
CREATE INDEX `team_members_status_idx` ON `team_members` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `workspace_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`document_type` text NOT NULL,
	`file_name` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256_hex` text NOT NULL,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`extraction_status` text DEFAULT 'not_configured' NOT NULL,
	`extracted_json` text DEFAULT '{}' NOT NULL,
	`uploaded_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_documents_size_check" CHECK("workspace_documents"."size_bytes" > 0 and "workspace_documents"."size_bytes" <= 10485760)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_documents_hash_unique` ON `workspace_documents` (`organization_id`,`sha256_hex`);--> statement-breakpoint
CREATE INDEX `workspace_documents_status_idx` ON `workspace_documents` (`organization_id`,`status`);