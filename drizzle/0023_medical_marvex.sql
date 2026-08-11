DROP INDEX `integration_connections_workspace_provider_unique`;--> statement-breakpoint
ALTER TABLE `integration_connections` ADD `source_namespace` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
CREATE INDEX `integration_connections_workspace_provider_idx` ON `integration_connections` (`organization_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `integration_connections_workspace_account_unique` ON `integration_connections` (`organization_id`,`provider`,`external_account_ref`);--> statement-breakpoint
CREATE UNIQUE INDEX `integration_connections_workspace_namespace_unique` ON `integration_connections` (`organization_id`,`provider`,`source_namespace`);--> statement-breakpoint
DROP INDEX `integration_secrets_workspace_provider_unique`;--> statement-breakpoint
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
DROP INDEX `commerce_customers_external_unique`;--> statement-breakpoint
ALTER TABLE `commerce_customers` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `commerce_customers`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `commerce_customers`.`organization_id` AND `provider` = `commerce_customers`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_customers_external_unique` ON `commerce_customers` (`organization_id`,`provider`,`connection_id`,`external_customer_id`);--> statement-breakpoint
DROP INDEX `commerce_payments_external_unique`;--> statement-breakpoint
ALTER TABLE `commerce_payments` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `commerce_payments`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `commerce_payments`.`organization_id` AND `provider` = `commerce_payments`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_payments_external_unique` ON `commerce_payments` (`organization_id`,`provider`,`connection_id`,`external_payment_id`);--> statement-breakpoint
DROP INDEX `commerce_products_external_unique`;--> statement-breakpoint
ALTER TABLE `commerce_products` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `commerce_products`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `commerce_products`.`organization_id` AND `provider` = `commerce_products`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_products_external_unique` ON `commerce_products` (`organization_id`,`provider`,`connection_id`,`external_product_id`);--> statement-breakpoint
DROP INDEX `commerce_sale_lines_external_unique`;--> statement-breakpoint
ALTER TABLE `commerce_sale_lines` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `commerce_sale_lines`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `commerce_sale_lines`.`organization_id` AND `provider` = `commerce_sale_lines`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_sale_lines_external_unique` ON `commerce_sale_lines` (`organization_id`,`provider`,`connection_id`,`external_sale_id`,`external_line_id`);--> statement-breakpoint
DROP INDEX `commerce_suppliers_external_unique`;--> statement-breakpoint
ALTER TABLE `commerce_suppliers` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `commerce_suppliers`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `commerce_suppliers`.`organization_id` AND `provider` = `commerce_suppliers`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_suppliers_external_unique` ON `commerce_suppliers` (`organization_id`,`provider`,`connection_id`,`external_supplier_id`);--> statement-breakpoint
DROP INDEX `integration_location_mappings_external_unique`;--> statement-breakpoint
DROP INDEX `integration_location_mappings_status_idx`;--> statement-breakpoint
ALTER TABLE `integration_location_mappings` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `integration_location_mappings`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `integration_location_mappings`.`organization_id` AND `provider` = `integration_location_mappings`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `integration_location_mappings_external_unique` ON `integration_location_mappings` (`organization_id`,`provider`,`connection_id`,`external_location_ref`);--> statement-breakpoint
CREATE INDEX `integration_location_mappings_status_idx` ON `integration_location_mappings` (`organization_id`,`provider`,`connection_id`,`status`);--> statement-breakpoint
DROP INDEX `integration_staged_financial_record_unique`;--> statement-breakpoint
ALTER TABLE `integration_staged_financial_records` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `integration_staged_financial_records`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `integration_staged_financial_records`.`organization_id` AND `provider` = `integration_staged_financial_records`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `integration_staged_financial_record_unique` ON `integration_staged_financial_records` (`organization_id`,`provider`,`connection_id`,`external_record_id`,`source_payload_hash`);--> statement-breakpoint
DROP INDEX `integration_staged_sales_version_unique`;--> statement-breakpoint
DROP INDEX `integration_staged_sales_outlet_date_idx`;--> statement-breakpoint
ALTER TABLE `integration_staged_sales` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `integration_staged_sales`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `integration_staged_sales`.`organization_id` AND `provider` = `integration_staged_sales`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `integration_staged_sales_version_unique` ON `integration_staged_sales` (`organization_id`,`provider`,`connection_id`,`external_sale_id`,`external_version`);--> statement-breakpoint
CREATE INDEX `integration_staged_sales_outlet_date_idx` ON `integration_staged_sales` (`organization_id`,`provider`,`connection_id`,`outlet_ref`,`sold_at`);--> statement-breakpoint
DROP INDEX `integration_sync_runs_workspace_provider_idx`;--> statement-breakpoint
ALTER TABLE `integration_sync_runs` ADD `connection_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `integration_sync_runs`
SET `connection_id` = COALESCE((SELECT `id` FROM `integration_connections` WHERE `organization_id` = `integration_sync_runs`.`organization_id` AND `provider` = `integration_sync_runs`.`provider` LIMIT 1), `connection_id`);--> statement-breakpoint
CREATE INDEX `integration_sync_runs_workspace_provider_idx` ON `integration_sync_runs` (`organization_id`,`provider`,`connection_id`,`started_at`);--> statement-breakpoint
DROP INDEX `integration_webhook_events_replay_unique`;--> statement-breakpoint
DROP INDEX `integration_webhook_events_status_idx`;--> statement-breakpoint
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
