CREATE TABLE `organizations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_email` text NOT NULL,
	`owner_name` text NOT NULL,
	`business_name` text NOT NULL,
	`legal_name` text NOT NULL,
	`business_email` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`industry` text NOT NULL,
	`country` text DEFAULT 'Canada' NOT NULL,
	`province` text DEFAULT 'Alberta' NOT NULL,
	`city` text NOT NULL,
	`address` text NOT NULL,
	`postal_code` text NOT NULL,
	`timezone` text DEFAULT 'America/Edmonton' NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`fiscal_year_start` text DEFAULT 'January' NOT NULL,
	`tax_number` text DEFAULT '' NOT NULL,
	`hours_json` text NOT NULL,
	`source_mode` text DEFAULT 'connect_later' NOT NULL,
	`selected_pos` text DEFAULT '' NOT NULL,
	`setup_complete` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_owner_email_unique` ON `organizations` (`owner_email`);