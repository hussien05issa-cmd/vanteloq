CREATE TABLE `customer_invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`description` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`tax_rate_basis_points` integer DEFAULT 0 NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `customer_invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "customer_invoice_lines_quantity_check" CHECK("customer_invoice_lines"."quantity_milli" > 0 and "customer_invoice_lines"."quantity_milli" <= 1000000000),
	CONSTRAINT "customer_invoice_lines_amount_check" CHECK("customer_invoice_lines"."unit_price_cents" >= 0 and "customer_invoice_lines"."subtotal_cents" >= 0 and "customer_invoice_lines"."tax_cents" >= 0 and "customer_invoice_lines"."total_cents" = "customer_invoice_lines"."subtotal_cents" + "customer_invoice_lines"."tax_cents"),
	CONSTRAINT "customer_invoice_lines_tax_check" CHECK("customer_invoice_lines"."tax_rate_basis_points" between 0 and 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_invoice_lines_invoice_line_unique` ON `customer_invoice_lines` (`organization_id`,`invoice_id`,`line_number`);--> statement-breakpoint
CREATE INDEX `customer_invoice_lines_invoice_idx` ON `customer_invoice_lines` (`organization_id`,`invoice_id`);--> statement-breakpoint
ALTER TABLE `customer_invoices` ADD `purchase_order_ref` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_invoices` ADD `issuer_snapshot_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_invoices` ADD `customer_snapshot_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_invoices` ADD `notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_invoices` ADD `payment_instructions` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_invoices` ADD `document_id` text REFERENCES workspace_documents(id);--> statement-breakpoint
ALTER TABLE `customer_invoices` ADD `sent_at` integer;--> statement-breakpoint
ALTER TABLE `customer_invoices` ADD `emailed_to` text;--> statement-breakpoint
CREATE UNIQUE INDEX `customer_invoices_document_unique` ON `customer_invoices` (`organization_id`,`document_id`);