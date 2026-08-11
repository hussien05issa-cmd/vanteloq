ALTER TABLE `account_preferences` ADD `hidden_navigation_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `account_preferences` ADD `preferred_location_id` text;