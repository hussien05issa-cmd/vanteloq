PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tenant_subscriptions` (
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
	CONSTRAINT "tenant_subscriptions_plan_check" CHECK("__new_tenant_subscriptions"."base_plan" is null or "__new_tenant_subscriptions"."base_plan" in ('starter','growth','pro','bookloq')),
	CONSTRAINT "tenant_subscriptions_interval_check" CHECK("__new_tenant_subscriptions"."billing_interval" is null or "__new_tenant_subscriptions"."billing_interval" in ('month','year')),
	CONSTRAINT "tenant_subscriptions_status_check" CHECK("__new_tenant_subscriptions"."status" in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),
	CONSTRAINT "tenant_subscriptions_scheduled_plan_check" CHECK("__new_tenant_subscriptions"."scheduled_base_plan" is null or "__new_tenant_subscriptions"."scheduled_base_plan" in ('starter','growth','pro','bookloq')),
	CONSTRAINT "tenant_subscriptions_scheduled_interval_check" CHECK("__new_tenant_subscriptions"."scheduled_billing_interval" is null or "__new_tenant_subscriptions"."scheduled_billing_interval" in ('month','year')),
	CONSTRAINT "tenant_subscriptions_version_check" CHECK("__new_tenant_subscriptions"."version" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_tenant_subscriptions`(
	"organization_id", "base_plan", "billing_interval", "status", "stripe_customer_id", "stripe_subscription_id",
	"stripe_base_price_id", "trial_ends_at", "current_period_ends_at", "cancel_at_period_end", "scheduled_base_plan",
	"scheduled_billing_interval", "scheduled_effective_at", "last_stripe_event_id", "last_stripe_event_created_at",
	"last_synced_at", "version", "created_at", "updated_at"
) SELECT
	"organization_id", "base_plan", "billing_interval", "status", "stripe_customer_id", "stripe_subscription_id",
	"stripe_base_price_id", "trial_ends_at", "current_period_ends_at", "cancel_at_period_end", "scheduled_base_plan",
	"scheduled_billing_interval", "scheduled_effective_at", "last_stripe_event_id", "last_stripe_event_created_at",
	"last_synced_at", "version", "created_at", "updated_at"
FROM `tenant_subscriptions`;--> statement-breakpoint
DROP TABLE `tenant_subscriptions`;--> statement-breakpoint
ALTER TABLE `__new_tenant_subscriptions` RENAME TO `tenant_subscriptions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_subscriptions_customer_unique` ON `tenant_subscriptions` (`stripe_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_subscriptions_subscription_unique` ON `tenant_subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE INDEX `tenant_subscriptions_status_idx` ON `tenant_subscriptions` (`status`,`updated_at`);
