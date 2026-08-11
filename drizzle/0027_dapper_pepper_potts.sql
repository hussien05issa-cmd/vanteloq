DROP INDEX `purchase_order_lines_product_idx`;--> statement-breakpoint
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
