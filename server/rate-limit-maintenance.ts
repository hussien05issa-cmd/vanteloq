// Expiry is twice the enforcement window. Never remove a live enforcement bucket.
export async function cleanupExpiredRateLimits(database: D1Database, now = Math.floor(Date.now() / 1000)) {
  const result = await database.prepare(`DELETE FROM rate_limit_buckets WHERE bucket_key IN
    (SELECT bucket_key FROM rate_limit_buckets WHERE expires_at<? ORDER BY expires_at LIMIT 500)`)
    .bind(now).run();
  return { removed: Number(result.meta.changes ?? 0) };
}
