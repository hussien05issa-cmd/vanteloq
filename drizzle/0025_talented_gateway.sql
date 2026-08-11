DROP INDEX IF EXISTS `integration_connections_workspace_provider_unique`;--> statement-breakpoint
ALTER TABLE `integration_connections` ADD `source_namespace` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
CREATE INDEX `integration_connections_workspace_provider_idx` ON `integration_connections` (`organization_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `integration_connections_workspace_account_unique` ON `integration_connections` (`organization_id`,`provider`,`external_account_ref`);--> statement-breakpoint
CREATE UNIQUE INDEX `integration_connections_workspace_namespace_unique` ON `integration_connections` (`organization_id`,`provider`,`source_namespace`);--> statement-breakpoint
DROP INDEX IF EXISTS `integration_secrets_workspace_provider_unique`;--> statement-breakpoint
ALTER TABLE `integration_secrets` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `integration_secrets`
SET `connection_id` = COALESCE((
  SELECT `integration_connections`.`id`
  FROM `integration_connections`
  WHERE `integration_connections`.`organization_id` = `integration_secrets`.`organization_id`
    AND `integration_connections`.`provider` = `integration_secrets`.`provider`
  LIMIT 1
), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `integration_secrets_connection_unique` ON `integration_secrets` (`connection_id`);--> statement-breakpoint
CREATE INDEX `integration_secrets_workspace_provider_idx` ON `integration_secrets` (`organization_id`,`provider`);--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_customers_external_unique`;--> statement-breakpoint
ALTER TABLE `commerce_customers` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `commerce_customers`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `commerce_customers`.`organization_id` AND `provider` = `commerce_customers`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_customers_external_unique` ON `commerce_customers` (`organization_id`,`provider`,`connection_id`,`external_customer_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_payments_external_unique`;--> statement-breakpoint
ALTER TABLE `commerce_payments` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `commerce_payments`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `commerce_payments`.`organization_id` AND `provider` = `commerce_payments`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_payments_external_unique` ON `commerce_payments` (`organization_id`,`provider`,`connection_id`,`external_payment_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_products_external_unique`;--> statement-breakpoint
ALTER TABLE `commerce_products` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `commerce_products`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `commerce_products`.`organization_id` AND `provider` = `commerce_products`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_products_external_unique` ON `commerce_products` (`organization_id`,`provider`,`connection_id`,`external_product_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_sale_lines_external_unique`;--> statement-breakpoint
ALTER TABLE `commerce_sale_lines` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `commerce_sale_lines`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `commerce_sale_lines`.`organization_id` AND `provider` = `commerce_sale_lines`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_sale_lines_external_unique` ON `commerce_sale_lines` (`organization_id`,`provider`,`connection_id`,`external_sale_id`,`external_line_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `commerce_suppliers_external_unique`;--> statement-breakpoint
ALTER TABLE `commerce_suppliers` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `commerce_suppliers`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `commerce_suppliers`.`organization_id` AND `provider` = `commerce_suppliers`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_suppliers_external_unique` ON `commerce_suppliers` (`organization_id`,`provider`,`connection_id`,`external_supplier_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `integration_location_mappings_external_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `integration_location_mappings_status_idx`;--> statement-breakpoint
ALTER TABLE `integration_location_mappings` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `integration_location_mappings`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `integration_location_mappings`.`organization_id` AND `provider` = `integration_location_mappings`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `integration_location_mappings_external_unique` ON `integration_location_mappings` (`organization_id`,`provider`,`connection_id`,`external_location_ref`);--> statement-breakpoint
CREATE INDEX `integration_location_mappings_status_idx` ON `integration_location_mappings` (`organization_id`,`provider`,`connection_id`,`status`);--> statement-breakpoint
DROP INDEX IF EXISTS `integration_staged_financial_record_unique`;--> statement-breakpoint
ALTER TABLE `integration_staged_financial_records` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `integration_staged_financial_records`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `integration_staged_financial_records`.`organization_id` AND `provider` = `integration_staged_financial_records`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `integration_staged_financial_record_unique` ON `integration_staged_financial_records` (`organization_id`,`provider`,`connection_id`,`external_record_id`,`source_payload_hash`);--> statement-breakpoint
DROP INDEX IF EXISTS `integration_staged_sales_version_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `integration_staged_sales_outlet_date_idx`;--> statement-breakpoint
ALTER TABLE `integration_staged_sales` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `integration_staged_sales`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `integration_staged_sales`.`organization_id` AND `provider` = `integration_staged_sales`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `integration_staged_sales_version_unique` ON `integration_staged_sales` (`organization_id`,`provider`,`connection_id`,`external_sale_id`,`external_version`);--> statement-breakpoint
CREATE INDEX `integration_staged_sales_outlet_date_idx` ON `integration_staged_sales` (`organization_id`,`provider`,`connection_id`,`outlet_ref`,`sold_at`);--> statement-breakpoint
DROP INDEX IF EXISTS `integration_sync_runs_workspace_provider_idx`;--> statement-breakpoint
ALTER TABLE `integration_sync_runs` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `integration_sync_runs`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `integration_sync_runs`.`organization_id` AND `provider` = `integration_sync_runs`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE INDEX `integration_sync_runs_workspace_provider_idx` ON `integration_sync_runs` (`organization_id`,`provider`,`connection_id`,`started_at`);--> statement-breakpoint
DROP INDEX IF EXISTS `integration_webhook_events_replay_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `integration_webhook_events_status_idx`;--> statement-breakpoint
ALTER TABLE `integration_webhook_events` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `integration_webhook_events`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `integration_webhook_events`.`organization_id` AND `provider` = `integration_webhook_events`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `integration_webhook_events_replay_unique` ON `integration_webhook_events` (`organization_id`,`provider`,`connection_id`,`payload_hash`);--> statement-breakpoint
CREATE INDEX `integration_webhook_events_status_idx` ON `integration_webhook_events` (`organization_id`,`provider`,`connection_id`,`status`,`received_at`);--> statement-breakpoint
ALTER TABLE `integration_oauth_states` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `integration_oauth_states`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `integration_oauth_states`.`organization_id` AND `provider` = `integration_oauth_states`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
ALTER TABLE `purchase_order_lines` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `purchase_order_lines` ADD `external_product_ref` text;--> statement-breakpoint
CREATE INDEX `purchase_order_lines_product_idx` ON `purchase_order_lines` (`organization_id`,`provider`,`external_product_ref`);
--> statement-breakpoint
ALTER TABLE `integration_connections` ADD `sync_lease_owner` text;--> statement-breakpoint
ALTER TABLE `integration_connections` ADD `sync_lease_expires_at` integer;--> statement-breakpoint
ALTER TABLE `integration_connections` ADD `sync_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE `daily_business_metrics` ADD `source_provider` text;--> statement-breakpoint
ALTER TABLE `daily_business_metrics` ADD `source_connection_id` text;--> statement-breakpoint
UPDATE `daily_business_metrics`
SET
	`source_provider` = (
		SELECT `integration_sync_runs`.`provider`
		FROM `data_imports`
		INNER JOIN `integration_sync_runs`
			ON `integration_sync_runs`.`id` = `data_imports`.`idempotency_key`
			AND `integration_sync_runs`.`organization_id` = `data_imports`.`organization_id`
		WHERE `data_imports`.`id` = `daily_business_metrics`.`source_import_id`
			AND `data_imports`.`organization_id` = `daily_business_metrics`.`organization_id`
		LIMIT 1
	),
	`source_connection_id` = (
		SELECT `integration_sync_runs`.`connection_id`
		FROM `data_imports`
		INNER JOIN `integration_sync_runs`
			ON `integration_sync_runs`.`id` = `data_imports`.`idempotency_key`
			AND `integration_sync_runs`.`organization_id` = `data_imports`.`organization_id`
		WHERE `data_imports`.`id` = `daily_business_metrics`.`source_import_id`
			AND `data_imports`.`organization_id` = `daily_business_metrics`.`organization_id`
		LIMIT 1
	)
WHERE EXISTS (
	SELECT 1
	FROM `data_imports`
	INNER JOIN `integration_sync_runs`
		ON `integration_sync_runs`.`id` = `data_imports`.`idempotency_key`
		AND `integration_sync_runs`.`organization_id` = `data_imports`.`organization_id`
	WHERE `data_imports`.`id` = `daily_business_metrics`.`source_import_id`
		AND `data_imports`.`organization_id` = `daily_business_metrics`.`organization_id`
);--> statement-breakpoint
CREATE INDEX `daily_metrics_workspace_source_idx` ON `daily_business_metrics` (`organization_id`,`source_connection_id`);--> statement-breakpoint
ALTER TABLE `inventory_balances` ADD `source_provider` text;--> statement-breakpoint
ALTER TABLE `inventory_balances` ADD `source_connection_id` text;--> statement-breakpoint
UPDATE `inventory_balances`
SET
	`source_provider` = (
		SELECT `integration_location_mappings`.`provider`
		FROM `integration_location_mappings`
		INNER JOIN `integration_connections`
			ON `integration_connections`.`id` = `integration_location_mappings`.`connection_id`
			AND `integration_connections`.`organization_id` = `integration_location_mappings`.`organization_id`
		WHERE `integration_location_mappings`.`organization_id` = `inventory_balances`.`organization_id`
			AND `inventory_balances`.`location_ref` = `integration_location_mappings`.`provider` || ':' ||
				CASE WHEN `integration_connections`.`source_namespace` = 'legacy'
					THEN `integration_location_mappings`.`external_location_ref`
					ELSE `integration_connections`.`source_namespace` || ':' || `integration_location_mappings`.`external_location_ref`
				END
		ORDER BY `integration_connections`.`created_at`, `integration_connections`.`id`
		LIMIT 1
	),
	`source_connection_id` = (
		SELECT `integration_location_mappings`.`connection_id`
		FROM `integration_location_mappings`
		INNER JOIN `integration_connections`
			ON `integration_connections`.`id` = `integration_location_mappings`.`connection_id`
			AND `integration_connections`.`organization_id` = `integration_location_mappings`.`organization_id`
		WHERE `integration_location_mappings`.`organization_id` = `inventory_balances`.`organization_id`
			AND `inventory_balances`.`location_ref` = `integration_location_mappings`.`provider` || ':' ||
				CASE WHEN `integration_connections`.`source_namespace` = 'legacy'
					THEN `integration_location_mappings`.`external_location_ref`
					ELSE `integration_connections`.`source_namespace` || ':' || `integration_location_mappings`.`external_location_ref`
				END
		ORDER BY `integration_connections`.`created_at`, `integration_connections`.`id`
		LIMIT 1
	)
WHERE EXISTS (
	SELECT 1
	FROM `integration_location_mappings`
	INNER JOIN `integration_connections`
		ON `integration_connections`.`id` = `integration_location_mappings`.`connection_id`
		AND `integration_connections`.`organization_id` = `integration_location_mappings`.`organization_id`
	WHERE `integration_location_mappings`.`organization_id` = `inventory_balances`.`organization_id`
		AND `inventory_balances`.`location_ref` = `integration_location_mappings`.`provider` || ':' ||
			CASE WHEN `integration_connections`.`source_namespace` = 'legacy'
				THEN `integration_location_mappings`.`external_location_ref`
				ELSE `integration_connections`.`source_namespace` || ':' || `integration_location_mappings`.`external_location_ref`
			END
);--> statement-breakpoint
CREATE INDEX `inventory_balances_workspace_source_idx` ON `inventory_balances` (`organization_id`,`source_connection_id`);
--> statement-breakpoint
DROP INDEX IF EXISTS `purchase_order_lines_product_idx`;--> statement-breakpoint
ALTER TABLE `purchase_order_lines` ADD `connection_id` text REFERENCES integration_connections(id);--> statement-breakpoint
UPDATE `purchase_order_lines`
SET `connection_id` = (
	SELECT MIN(`commerce_products`.`connection_id`)
	FROM `commerce_products`
	INNER JOIN `integration_connections`
		ON `integration_connections`.`id` = `commerce_products`.`connection_id`
		AND `integration_connections`.`organization_id` = `commerce_products`.`organization_id`
	WHERE `commerce_products`.`organization_id` = `purchase_order_lines`.`organization_id`
		AND `commerce_products`.`provider` = `purchase_order_lines`.`provider`
		AND `commerce_products`.`external_product_id` = `purchase_order_lines`.`external_product_ref`
	GROUP BY `commerce_products`.`organization_id`, `commerce_products`.`provider`, `commerce_products`.`external_product_id`
	HAVING COUNT(DISTINCT `commerce_products`.`connection_id`) = 1
)
WHERE `purchase_order_lines`.`provider` IS NOT NULL
	AND `purchase_order_lines`.`external_product_ref` IS NOT NULL
	AND (
		SELECT COUNT(DISTINCT `commerce_products`.`connection_id`)
		FROM `commerce_products`
		INNER JOIN `integration_connections`
			ON `integration_connections`.`id` = `commerce_products`.`connection_id`
			AND `integration_connections`.`organization_id` = `commerce_products`.`organization_id`
		WHERE `commerce_products`.`organization_id` = `purchase_order_lines`.`organization_id`
			AND `commerce_products`.`provider` = `purchase_order_lines`.`provider`
			AND `commerce_products`.`external_product_id` = `purchase_order_lines`.`external_product_ref`
	) = 1;--> statement-breakpoint
CREATE INDEX `purchase_order_lines_product_idx` ON `purchase_order_lines` (`organization_id`,`provider`,`connection_id`,`external_product_ref`);
--> statement-breakpoint
ALTER TABLE `integration_connections` ADD `promotion_authorized_at` integer;--> statement-breakpoint
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
	`security_state` text DEFAULT 'quarantined' NOT NULL,
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
	CONSTRAINT "workspace_documents_security_state_check" CHECK("__new_workspace_documents"."security_state" in ('quarantined', 'clean', 'rejected')),
	CONSTRAINT "workspace_documents_size_check" CHECK("__new_workspace_documents"."size_bytes" > 0 and "__new_workspace_documents"."size_bytes" <= 10485760),
	CONSTRAINT "workspace_documents_scan_status_check" CHECK("__new_workspace_documents"."scan_status" in ('pending', 'clean', 'blocked', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_workspace_documents`("id", "organization_id", "document_type", "file_name", "object_key", "content_type", "size_bytes", "sha256_hex", "security_state", "status", "scan_status", "scanned_at", "scan_provider", "extraction_status", "extracted_json", "uploaded_by_user_id", "created_at", "updated_at") SELECT "id", "organization_id", "document_type", "file_name", "object_key", "content_type", "size_bytes", "sha256_hex", 'quarantined', "status", "scan_status", "scanned_at", "scan_provider", "extraction_status", "extracted_json", "uploaded_by_user_id", "created_at", "updated_at" FROM `workspace_documents`;--> statement-breakpoint
DROP TABLE `workspace_documents`;--> statement-breakpoint
ALTER TABLE `__new_workspace_documents` RENAME TO `workspace_documents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_documents_hash_unique` ON `workspace_documents` (`organization_id`,`sha256_hex`);--> statement-breakpoint
CREATE INDEX `workspace_documents_status_idx` ON `workspace_documents` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `workspace_documents_scan_idx` ON `workspace_documents` (`organization_id`,`scan_status`);
