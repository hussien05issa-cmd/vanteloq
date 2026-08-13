CREATE TABLE `bookloq_category_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`match_text` text NOT NULL,
	`direction` text DEFAULT 'any' NOT NULL,
	`account_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bookloq_category_rules_direction_check" CHECK("bookloq_category_rules"."direction" in ('any', 'inflow', 'outflow')),
	CONSTRAINT "bookloq_category_rules_match_text_check" CHECK(length("bookloq_category_rules"."match_text") between 3 and 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookloq_category_rules_workspace_name_unique` ON `bookloq_category_rules` (`organization_id`,`name`);--> statement-breakpoint
CREATE INDEX `bookloq_category_rules_workspace_active_idx` ON `bookloq_category_rules` (`organization_id`,`active`);--> statement-breakpoint
CREATE TABLE `bookloq_transaction_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`supplier_bill_id` text,
	`customer_invoice_id` text,
	`document_id` text,
	`status` text DEFAULT 'suggested' NOT NULL,
	`method` text DEFAULT 'manual' NOT NULL,
	`confidence_basis_points` integer DEFAULT 0 NOT NULL,
	`matched_amount_cents` integer NOT NULL,
	`reasons_json` text DEFAULT '[]' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`matched_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supplier_bill_id`) REFERENCES `supplier_bills`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_invoice_id`) REFERENCES `customer_invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `workspace_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matched_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bookloq_transaction_matches_target_check" CHECK((("bookloq_transaction_matches"."supplier_bill_id" is not null) + ("bookloq_transaction_matches"."customer_invoice_id" is not null) + ("bookloq_transaction_matches"."document_id" is not null)) = 1),
	CONSTRAINT "bookloq_transaction_matches_status_check" CHECK("bookloq_transaction_matches"."status" in ('suggested', 'confirmed', 'rejected')),
	CONSTRAINT "bookloq_transaction_matches_method_check" CHECK("bookloq_transaction_matches"."method" in ('manual', 'amount_reference_date')),
	CONSTRAINT "bookloq_transaction_matches_confidence_check" CHECK("bookloq_transaction_matches"."confidence_basis_points" between 0 and 10000),
	CONSTRAINT "bookloq_transaction_matches_amount_check" CHECK("bookloq_transaction_matches"."matched_amount_cents" > 0)
);
--> statement-breakpoint
CREATE INDEX `bookloq_transaction_matches_workspace_transaction_idx` ON `bookloq_transaction_matches` (`organization_id`,`transaction_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `bookloq_transaction_matches_bill_unique` ON `bookloq_transaction_matches` (`organization_id`,`transaction_id`,`supplier_bill_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bookloq_transaction_matches_invoice_unique` ON `bookloq_transaction_matches` (`organization_id`,`transaction_id`,`customer_invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bookloq_transaction_matches_document_unique` ON `bookloq_transaction_matches` (`organization_id`,`transaction_id`,`document_id`);