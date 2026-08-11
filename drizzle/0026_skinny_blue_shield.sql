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
