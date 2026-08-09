CREATE TABLE `tenant_addons` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`addon_key` text NOT NULL,
	`status` text NOT NULL,
	`stripe_subscription_item_id` text,
	`stripe_price_id` text,
	`current_period_ends_at` integer,
	`scheduled_removal_at` integer,
	`last_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tenant_addons_key_check" CHECK("tenant_addons"."addon_key" in ('bookloq')),
	CONSTRAINT "tenant_addons_status_check" CHECK("tenant_addons"."status" in ('trialing','active','scheduled_for_removal','inactive'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_addons_key_unique` ON `tenant_addons` (`organization_id`,`addon_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_addons_item_unique` ON `tenant_addons` (`stripe_subscription_item_id`);--> statement-breakpoint
CREATE INDEX `tenant_addons_status_idx` ON `tenant_addons` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `tenant_subscriptions` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`base_plan` text,
	`billing_interval` text,
	`status` text DEFAULT 'incomplete' NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`stripe_base_price_id` text,
	`trial_ends_at` integer,
	`current_period_ends_at` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`scheduled_base_plan` text,
	`scheduled_billing_interval` text,
	`scheduled_effective_at` integer,
	`last_stripe_event_id` text,
	`last_stripe_event_created_at` integer,
	`last_synced_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tenant_subscriptions_plan_check" CHECK("tenant_subscriptions"."base_plan" is null or "tenant_subscriptions"."base_plan" in ('starter','growth','pro')),
	CONSTRAINT "tenant_subscriptions_interval_check" CHECK("tenant_subscriptions"."billing_interval" is null or "tenant_subscriptions"."billing_interval" in ('month','year')),
	CONSTRAINT "tenant_subscriptions_status_check" CHECK("tenant_subscriptions"."status" in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),
	CONSTRAINT "tenant_subscriptions_scheduled_plan_check" CHECK("tenant_subscriptions"."scheduled_base_plan" is null or "tenant_subscriptions"."scheduled_base_plan" in ('starter','growth','pro')),
	CONSTRAINT "tenant_subscriptions_scheduled_interval_check" CHECK("tenant_subscriptions"."scheduled_billing_interval" is null or "tenant_subscriptions"."scheduled_billing_interval" in ('month','year')),
	CONSTRAINT "tenant_subscriptions_version_check" CHECK("tenant_subscriptions"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_subscriptions_customer_unique` ON `tenant_subscriptions` (`stripe_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_subscriptions_subscription_unique` ON `tenant_subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE INDEX `tenant_subscriptions_status_idx` ON `tenant_subscriptions` (`status`,`updated_at`);