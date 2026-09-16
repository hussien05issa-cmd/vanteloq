CREATE TABLE `marketing_email_intents` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `email_hash` text NOT NULL,
  `selected` integer NOT NULL,
  `notice_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `source_hash` text,
  `user_agent_hash` text,
  CONSTRAINT `marketing_email_intents_choice_check` CHECK(`selected` IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `marketing_email_intents_expiry_idx` ON `marketing_email_intents` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `marketing_email_intents_email_idx` ON `marketing_email_intents` (`email_hash`);
--> statement-breakpoint
CREATE TABLE `marketing_email_preferences` (
  `email_hash` text PRIMARY KEY NOT NULL,
  `subject_hash` text,
  `email_encrypted` text,
  `status` text NOT NULL,
  `current_event_id` text NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT `marketing_email_preferences_status_check` CHECK(`status` IN ('subscribed','declined','unsubscribed','suppressed')),
  CONSTRAINT `marketing_email_preferences_recipient_check` CHECK(`status` <> 'subscribed' OR (`email_encrypted` IS NOT NULL AND `subject_hash` IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `marketing_email_preferences_subject_idx` ON `marketing_email_preferences` (`subject_hash`);
--> statement-breakpoint
CREATE TABLE `marketing_email_events` (
  `id` text PRIMARY KEY NOT NULL,
  `email_hash` text NOT NULL,
  `subject_hash` text,
  `action` text NOT NULL,
  `source` text NOT NULL,
  `notice_json` text NOT NULL,
  `occurred_at` integer NOT NULL,
  `intent_at` integer,
  `source_hash` text,
  `user_agent_hash` text,
  CONSTRAINT `marketing_email_events_action_check` CHECK(`action` IN ('subscribed','declined','unsubscribed','suppressed'))
);
--> statement-breakpoint
CREATE INDEX `marketing_email_events_email_idx` ON `marketing_email_events` (`email_hash`, `occurred_at`);
--> statement-breakpoint
CREATE INDEX `marketing_email_events_subject_idx` ON `marketing_email_events` (`subject_hash`);
--> statement-breakpoint
CREATE TABLE `marketing_email_unsubscribe_tokens` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `email_hash` text NOT NULL,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  FOREIGN KEY (`email_hash`) REFERENCES `marketing_email_preferences`(`email_hash`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `marketing_email_unsubscribe_expiry_idx` ON `marketing_email_unsubscribe_tokens` (`expires_at`);
