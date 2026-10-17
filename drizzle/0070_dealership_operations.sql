CREATE TABLE `dealership_appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`lead_id`) REFERENCES `dealership_leads`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dealership_appointments_check_1" CHECK(status IN ('scheduled','attended','no_show','cancelled')),
	CONSTRAINT "dealership_appointments_check_2" CHECK(version>0)
);
--> statement-breakpoint
CREATE INDEX `dealership_appointment_lead` ON `dealership_appointments` (`organization_id`,`lead_id`,`scheduled_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `dealership_appointments_organization_id_id_unique` ON `dealership_appointments` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `dealership_cost_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`episode_id` text NOT NULL,
	`category` text NOT NULL,
	`status` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`description` text NOT NULL,
	`source_reference` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`episode_id`) REFERENCES `dealership_stock_episodes`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dealership_cost_lines_check_1" CHECK(category IN ('acquisition','auction','transport','preparation','other')),
	CONSTRAINT "dealership_cost_lines_check_2" CHECK(status IN ('recorded','estimated','approved','posted')),
	CONSTRAINT "dealership_cost_lines_check_3" CHECK(typeof(amount_cents)='integer' AND amount_cents BETWEEN 0 AND 1000000000)
);
--> statement-breakpoint
CREATE INDEX `dealership_cost_episode` ON `dealership_cost_lines` (`organization_id`,`episode_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `dealership_cost_lines_organization_id_id_unique` ON `dealership_cost_lines` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `dealership_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_id` text,
	`detail_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `dealership_event_resource` ON `dealership_events` (`organization_id`,`resource_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `dealership_leads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`customer_name` text NOT NULL,
	`contact` text DEFAULT '' NOT NULL,
	`stage` text NOT NULL,
	`assignee_id` text,
	`next_action_date` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "dealership_leads_check_1" CHECK(stage IN ('new','contacted','appointment','negotiation','lost')),
	CONSTRAINT "dealership_leads_check_2" CHECK(version>0)
);
--> statement-breakpoint
CREATE INDEX `dealership_lead_scope` ON `dealership_leads` (`organization_id`,`location_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `dealership_leads_organization_id_id_unique` ON `dealership_leads` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `dealership_mutations` (
	`organization_id` text NOT NULL,
	`mutation_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `mutation_key`),
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dealership_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`episode_id` text NOT NULL,
	`lead_id` text,
	`expires_at` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`episode_id`) REFERENCES `dealership_stock_episodes`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`lead_id`) REFERENCES `dealership_leads`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dealership_reservations_check_1" CHECK(status IN ('active','released','expired','delivered'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dealership_exclusive_reservation` ON `dealership_reservations` (`organization_id`,`episode_id`) WHERE status='active';--> statement-breakpoint
CREATE TABLE `dealership_sale_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`person_id` text,
	`person_name` text NOT NULL,
	`share_bps` integer NOT NULL,
	`approved_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`,`sale_id`) REFERENCES `dealership_sales`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dealership_sale_credits_check_1" CHECK(typeof(share_bps)='integer' AND share_bps BETWEEN 1 AND 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dealership_sale_credits_organization_id_sale_id_person_id_unique` ON `dealership_sale_credits` (`organization_id`,`sale_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `dealership_sales` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`episode_id` text NOT NULL,
	`location_id` text NOT NULL,
	`delivered_date` text NOT NULL,
	`channel` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`cost_cents` integer,
	`status` text DEFAULT 'delivered' NOT NULL,
	`reversal_date` text,
	`reversal_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`episode_id`) REFERENCES `dealership_stock_episodes`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dealership_sales_check_1" CHECK(channel IN ('retail','wholesale')),
	CONSTRAINT "dealership_sales_check_2" CHECK(typeof(amount_cents)='integer' AND amount_cents BETWEEN 0 AND 1000000000),
	CONSTRAINT "dealership_sales_check_3" CHECK(cost_cents IS NULL OR (typeof(cost_cents)='integer' AND cost_cents>=0)),
	CONSTRAINT "dealership_sales_check_4" CHECK(status IN ('delivered','reversed'))
);
--> statement-breakpoint
CREATE INDEX `dealership_sale_period` ON `dealership_sales` (`organization_id`,`location_id`,`delivered_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `dealership_sales_organization_id_id_unique` ON `dealership_sales` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `dealership_sales_organization_id_episode_id_unique` ON `dealership_sales` (`organization_id`,`episode_id`);--> statement-breakpoint
CREATE TABLE `dealership_stock_episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	`location_id` text NOT NULL,
	`location_name` text NOT NULL,
	`stock_number` text NOT NULL,
	`currency` text NOT NULL,
	`acquired_date` text NOT NULL,
	`ownership` text NOT NULL,
	`physical_status` text NOT NULL,
	`prep_status` text NOT NULL,
	`availability` text NOT NULL,
	`asking_cents` integer,
	`cost_complete` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`exit_date` text,
	`source` text NOT NULL,
	`legacy_vehicle_id` text,
	`legacy_incomplete` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`vehicle_id`) REFERENCES `dealership_vehicle_identities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dealership_stock_episodes_check_1" CHECK(length(currency)=3),
	CONSTRAINT "dealership_stock_episodes_check_2" CHECK(ownership IN ('owned','consignment','unknown')),
	CONSTRAINT "dealership_stock_episodes_check_3" CHECK(physical_status IN ('on_lot','offsite','in_transit','unknown')),
	CONSTRAINT "dealership_stock_episodes_check_4" CHECK(prep_status IN ('not_started','in_progress','ready','blocked','unknown')),
	CONSTRAINT "dealership_stock_episodes_check_5" CHECK(availability IN ('available','held','reserved','delivered','archived','legacy_sold')),
	CONSTRAINT "dealership_stock_episodes_check_6" CHECK(asking_cents IS NULL OR (typeof(asking_cents)='integer' AND asking_cents BETWEEN 0 AND 1000000000)),
	CONSTRAINT "dealership_stock_episodes_check_7" CHECK(cost_complete IN (0,1)),
	CONSTRAINT "dealership_stock_episodes_check_8" CHECK(is_active IN (0,1)),
	CONSTRAINT "dealership_stock_episodes_check_9" CHECK(source IN ('manual','csv','legacy')),
	CONSTRAINT "dealership_stock_episodes_check_10" CHECK(legacy_incomplete IN (0,1)),
	CONSTRAINT "dealership_stock_episodes_check_11" CHECK(version>0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dealership_active_vehicle` ON `dealership_stock_episodes` (`organization_id`,`vehicle_id`) WHERE is_active=1;--> statement-breakpoint
CREATE UNIQUE INDEX `dealership_active_stock_number` ON `dealership_stock_episodes` (`organization_id`,`stock_number`) WHERE is_active=1;--> statement-breakpoint
CREATE INDEX `dealership_stock_scope` ON `dealership_stock_episodes` (`organization_id`,`location_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `dealership_stock_episodes_organization_id_id_unique` ON `dealership_stock_episodes` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `dealership_stock_episodes_organization_id_legacy_vehicle_id_unique` ON `dealership_stock_episodes` (`organization_id`,`legacy_vehicle_id`);--> statement-breakpoint
CREATE TABLE `dealership_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`episode_id` text,
	`lead_id` text,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`assignee_id` text,
	`due_date` text,
	`blocked_reason` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`,`episode_id`) REFERENCES `dealership_stock_episodes`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`lead_id`) REFERENCES `dealership_leads`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dealership_tasks_check_1" CHECK(status IN ('open','in_progress','blocked','done')),
	CONSTRAINT "dealership_tasks_check_2" CHECK(version>0),
	CONSTRAINT "dealership_tasks_check_3" CHECK((episode_id IS NOT NULL AND lead_id IS NULL) OR (episode_id IS NULL AND lead_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `dealership_task_episode` ON `dealership_tasks` (`organization_id`,`episode_id`,`status`);--> statement-breakpoint
CREATE INDEX `dealership_task_lead` ON `dealership_tasks` (`organization_id`,`lead_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `dealership_tasks_organization_id_id_unique` ON `dealership_tasks` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `dealership_vehicle_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`identifier_kind` text NOT NULL,
	`identifier` text NOT NULL,
	`model_year` integer NOT NULL,
	`make` text NOT NULL,
	`model` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "dealership_vehicle_identities_check_1" CHECK(identifier_kind IN ('vin','legacy'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dealership_vehicle_identities_organization_id_id_unique` ON `dealership_vehicle_identities` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `dealership_vehicle_identities_organization_id_identifier_unique` ON `dealership_vehicle_identities` (`organization_id`,`identifier`);--> statement-breakpoint
CREATE TABLE `dealership_write_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`permitted` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "dealership_write_guards_check_1" CHECK(permitted=1)
);

--> statement-breakpoint
CREATE TRIGGER dealership_stock_location_insert BEFORE INSERT ON dealership_stock_episodes
WHEN NOT EXISTS(SELECT 1 FROM organization_locations WHERE id=NEW.location_id AND organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'dealership location mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER dealership_stock_location_update BEFORE UPDATE OF location_id,organization_id ON dealership_stock_episodes
WHEN NOT EXISTS(SELECT 1 FROM organization_locations WHERE id=NEW.location_id AND organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'dealership location mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER dealership_lead_location_insert BEFORE INSERT ON dealership_leads
WHEN NOT EXISTS(SELECT 1 FROM organization_locations WHERE id=NEW.location_id AND organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'dealership location mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER dealership_lead_location_update BEFORE UPDATE OF location_id,organization_id ON dealership_leads
WHEN NOT EXISTS(SELECT 1 FROM organization_locations WHERE id=NEW.location_id AND organization_id=NEW.organization_id)
BEGIN SELECT RAISE(ABORT,'dealership location mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER dealership_reservation_available BEFORE INSERT ON dealership_reservations
WHEN NEW.status='active' AND NOT EXISTS(SELECT 1 FROM dealership_stock_episodes WHERE id=NEW.episode_id AND organization_id=NEW.organization_id AND is_active=1 AND availability='available')
BEGIN SELECT RAISE(ABORT,'dealership stock unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER dealership_sale_available BEFORE INSERT ON dealership_sales
WHEN NOT EXISTS(SELECT 1 FROM dealership_stock_episodes WHERE id=NEW.episode_id AND organization_id=NEW.organization_id AND location_id=NEW.location_id AND is_active=1 AND availability IN ('available','reserved') AND ownership IN ('owned','consignment') AND prep_status='ready' AND physical_status='on_lot')
BEGIN SELECT RAISE(ABORT,'dealership stock not ready for delivery'); END;
--> statement-breakpoint
CREATE TRIGGER dealership_credit_total BEFORE INSERT ON dealership_sale_credits
WHEN (SELECT coalesce(sum(share_bps),0) FROM dealership_sale_credits WHERE organization_id=NEW.organization_id AND sale_id=NEW.sale_id)+NEW.share_bps>10000
BEGIN SELECT RAISE(ABORT,'dealership credit exceeds 100 percent'); END;
--> statement-breakpoint
CREATE TRIGGER dealership_credit_identity_delete BEFORE DELETE ON users
BEGIN UPDATE dealership_sale_credits SET person_name='Former member' WHERE person_id=OLD.id; END;
