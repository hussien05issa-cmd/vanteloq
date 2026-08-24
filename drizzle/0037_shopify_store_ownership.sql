CREATE TABLE `shopify_store_locks` (
	`shop_domain` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shopify_store_locks_workspace_idx` ON `shopify_store_locks` (`organization_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `shopify_store_locks` (`shop_domain`, `organization_id`, `created_at`, `updated_at`)
SELECT lower(`domain_prefix`), `organization_id`, CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `integration_connections`
WHERE `provider` IN ('shopify', 'shopify-pos')
  AND `status` IN ('pending', 'connected')
  AND `domain_prefix` IS NOT NULL
ORDER BY `created_at` ASC;
