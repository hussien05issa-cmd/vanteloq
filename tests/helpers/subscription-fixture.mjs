export async function activateTestSubscription(database, organizationId, plan = "pro") {
  const now = Date.now();
  await database.prepare(`INSERT INTO tenant_subscriptions
    (organization_id, base_plan, billing_interval, status, cancel_at_period_end, version, created_at, updated_at)
    VALUES (?, ?, 'month', 'active', 0, 1, ?, ?)
    ON CONFLICT(organization_id) DO UPDATE SET
      base_plan = excluded.base_plan,
      billing_interval = excluded.billing_interval,
      status = excluded.status,
      cancel_at_period_end = 0,
      version = tenant_subscriptions.version + 1,
      updated_at = excluded.updated_at`)
    .bind(organizationId, plan, now, now)
    .run();
}
