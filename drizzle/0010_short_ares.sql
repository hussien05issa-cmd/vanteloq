CREATE TABLE `growth_touchpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`source` text NOT NULL,
	`stage` text NOT NULL,
	`journey_ref` text NOT NULL,
	`source_system` text NOT NULL,
	`source_event_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "growth_touchpoints_stage_check" CHECK("growth_touchpoints"."stage" in ('discovery','website','phone_call','lead','customer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `growth_touchpoints_source_event_unique` ON `growth_touchpoints` (`organization_id`,`source_system`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `growth_touchpoints_journey_idx` ON `growth_touchpoints` (`organization_id`,`journey_ref`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `growth_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`journey_ref` text NOT NULL,
	`revenue_cents` integer NOT NULL,
	`gross_profit_cents` integer,
	`source_system` text NOT NULL,
	`source_event_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "growth_transactions_amount_check" CHECK("growth_transactions"."revenue_cents" >= 0 and ("growth_transactions"."gross_profit_cents" is null or "growth_transactions"."gross_profit_cents" <= "growth_transactions"."revenue_cents"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `growth_transactions_source_event_unique` ON `growth_transactions` (`organization_id`,`source_system`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `growth_transactions_journey_idx` ON `growth_transactions` (`organization_id`,`journey_ref`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `search_visibility_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`query` text NOT NULL,
	`observed_date` text NOT NULL,
	`position_milli` integer NOT NULL,
	`discovery_actions` integer,
	`source_system` text NOT NULL,
	`source_event_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "search_visibility_position_check" CHECK("search_visibility_observations"."position_milli" > 0),
	CONSTRAINT "search_visibility_actions_check" CHECK("search_visibility_observations"."discovery_actions" is null or "search_visibility_observations"."discovery_actions" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_visibility_source_event_unique` ON `search_visibility_observations` (`organization_id`,`source_system`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `search_visibility_query_date_idx` ON `search_visibility_observations` (`organization_id`,`query`,`observed_date`);