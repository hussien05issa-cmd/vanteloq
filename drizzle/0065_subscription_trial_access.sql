ALTER TABLE tenant_subscriptions ADD COLUMN trial_access_ends_at integer;
--> statement-breakpoint
ALTER TABLE tenant_subscriptions ADD COLUMN trial_converted_at integer;
