-- Repair only plausible epoch-millisecond values in relational document timestamps.
-- JSON authorization, lease and deletion-request times intentionally stay in milliseconds.
-- Correct seconds, pre-2020 values and implausibly future values remain untouched.
UPDATE workspace_documents
SET created_at = CAST(created_at / 1000 AS INTEGER)
WHERE typeof(created_at) = 'integer'
  AND created_at > 100000000000
  AND created_at >= 1577836800000
  AND created_at <= (unixepoch('now') + 86400) * 1000;
--> statement-breakpoint
UPDATE workspace_documents
SET updated_at = CAST(updated_at / 1000 AS INTEGER)
WHERE typeof(updated_at) = 'integer'
  AND updated_at > 100000000000
  AND updated_at >= 1577836800000
  AND updated_at <= (unixepoch('now') + 86400) * 1000;
