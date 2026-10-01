import { ApiError } from "../api.ts";
import type { NormalizedBillingSubscription } from "./stripe.ts";
import { SUBSCRIPTION_TRIAL_DAYS, SUBSCRIPTION_TRIAL_POLICY, SUBSCRIPTION_TRIAL_SECONDS } from "../../shared/subscription-trial.ts";

/** Save one verified Stripe snapshot and its add-on as a single transaction. */
export async function persistStripeSubscription(database: D1Database, input: {
  subscription: NormalizedBillingSubscription;
  eventId: string;
  eventCreated: number;
  expectedVersion: number;
}) {
  const { subscription: s, eventId, eventCreated, expectedVersion } = input;
  const now = Math.floor(Date.now() / 1000);
  const seconds = (date: Date | null) => date ? Math.floor(date.getTime() / 1000) : null;
  const current = await database.prepare("SELECT stripe_subscription_id,trial_access_ends_at,trial_converted_at FROM tenant_subscriptions WHERE organization_id=?")
    .bind(s.organizationId).first<{ stripe_subscription_id: string | null; trial_access_ends_at: number | null; trial_converted_at: number | null }>();
  const sameSubscription = current?.stripe_subscription_id === s.subscriptionId;
  let trialAccessEndsAt = sameSubscription ? current.trial_access_ends_at : null;
  let trialConvertedAt = sameSubscription ? current.trial_converted_at : null;
  if (!trialAccessEndsAt && (!current?.stripe_subscription_id || sameSubscription) && s.trialPolicy === SUBSCRIPTION_TRIAL_POLICY && s.trialStartsAt && s.trialEndsAt) {
    const attempt = await database.prepare("SELECT attempt_id,request_body,created_at FROM billing_checkout_attempts WHERE organization_id=?")
      .bind(s.organizationId).first<{ attempt_id: string; request_body: string; created_at: number }>();
    const fields = new URLSearchParams(attempt?.request_body ?? "");
    const start = seconds(s.trialStartsAt)!;
    if (attempt && attempt.attempt_id === s.checkoutAttemptId && fields.get("subscription_data[trial_period_days]") === String(SUBSCRIPTION_TRIAL_DAYS)
      && fields.get("subscription_data[metadata][vanteloq_trial_policy]") === SUBSCRIPTION_TRIAL_POLICY
      && fields.get("subscription_data[metadata][vanteloq_organization_id]") === s.organizationId
      && fields.get("payment_method_collection") === "always"
      && start >= attempt.created_at && start <= Number(fields.get("expires_at")) && start <= now
      && seconds(s.trialEndsAt)! > start) {
      trialAccessEndsAt = Math.min(start + SUBSCRIPTION_TRIAL_SECONDS, seconds(s.trialEndsAt)!);
    }
  }
  if (s.trialPolicy === SUBSCRIPTION_TRIAL_POLICY && !trialAccessEndsAt) {
    throw new ApiError(409, "STRIPE_TRIAL_AUTHORIZATION_REQUIRED", "The trial must match the workspace's verified first checkout.");
  }
  if (trialAccessEndsAt && !trialConvertedAt && s.status === "active" && s.paidInvoicePeriodEndsAt
    && s.paidInvoicePeriodEndsAt.getTime() > (s.trialEndsAt?.getTime() ?? trialAccessEndsAt * 1000)) trialConvertedAt = now;
  const addon = s.addon;
  const addonStatus = addon && s.status === "active" ? "active" : addon && s.status === "trialing" && trialAccessEndsAt ? "trialing" : "inactive";
  const addonWrite = s.basePlan === "bookloq"
    ? database.prepare(`DELETE FROM tenant_addons WHERE organization_id = ? AND addon_key = 'bookloq'
        AND EXISTS (SELECT 1 FROM tenant_subscriptions WHERE organization_id = ? AND last_stripe_event_id = ?)`)
      .bind(s.organizationId, s.organizationId, eventId)
    : database.prepare(`INSERT INTO tenant_addons
      (id, organization_id, addon_key, status, stripe_subscription_item_id, stripe_price_id,
       current_period_ends_at, scheduled_removal_at, last_synced_at, created_at, updated_at)
      SELECT ?, ?, 'bookloq', ?, ?, ?, ?, NULL, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM tenant_subscriptions WHERE organization_id = ? AND last_stripe_event_id = ?)
      ON CONFLICT(organization_id, addon_key) DO UPDATE SET
        status = excluded.status, stripe_subscription_item_id = excluded.stripe_subscription_item_id,
        stripe_price_id = excluded.stripe_price_id, current_period_ends_at = excluded.current_period_ends_at,
        scheduled_removal_at = NULL, last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at`)
      .bind(crypto.randomUUID(), s.organizationId, addonStatus, addon?.itemId ?? null, addon?.priceId ?? null,
        seconds(addon?.currentPeriodEndsAt ?? null), now, now, now, s.organizationId, eventId);
  const [saved] = await database.batch([
    database.prepare(`INSERT INTO tenant_subscriptions
      (organization_id, base_plan, billing_interval, status, stripe_customer_id, stripe_subscription_id,
       stripe_base_price_id, trial_ends_at, trial_access_ends_at, trial_converted_at, current_period_ends_at, cancel_at_period_end,
       last_stripe_event_id, last_stripe_event_created_at, last_synced_at, version, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ? WHERE ? = 0
        OR EXISTS (SELECT 1 FROM tenant_subscriptions WHERE organization_id = ?)
      ON CONFLICT(organization_id) DO UPDATE SET
        base_plan = excluded.base_plan, billing_interval = excluded.billing_interval, status = excluded.status,
        stripe_customer_id = excluded.stripe_customer_id, stripe_subscription_id = excluded.stripe_subscription_id,
        stripe_base_price_id = excluded.stripe_base_price_id, trial_ends_at = excluded.trial_ends_at,
        trial_access_ends_at = excluded.trial_access_ends_at, trial_converted_at = excluded.trial_converted_at,
        current_period_ends_at = excluded.current_period_ends_at, cancel_at_period_end = excluded.cancel_at_period_end,
        scheduled_base_plan = NULL, scheduled_billing_interval = NULL, scheduled_effective_at = NULL,
        last_stripe_event_id = excluded.last_stripe_event_id, last_stripe_event_created_at = excluded.last_stripe_event_created_at,
        last_synced_at = excluded.last_synced_at, version = tenant_subscriptions.version + 1, updated_at = excluded.updated_at
      WHERE tenant_subscriptions.version = ?
        AND (tenant_subscriptions.last_stripe_event_created_at IS NULL OR tenant_subscriptions.last_stripe_event_created_at <= ?)
        AND (tenant_subscriptions.stripe_customer_id IS NULL OR tenant_subscriptions.stripe_customer_id = excluded.stripe_customer_id)
        AND (tenant_subscriptions.stripe_subscription_id IS NULL OR tenant_subscriptions.stripe_subscription_id = excluded.stripe_subscription_id
          OR (tenant_subscriptions.status IN ('canceled','incomplete_expired') AND excluded.status IN ('active','trialing','incomplete')))`)
      .bind(s.organizationId, s.basePlan, s.billingInterval, s.status, s.customerId, s.subscriptionId,
        s.basePriceId, seconds(s.trialEndsAt), trialAccessEndsAt, trialConvertedAt, seconds(s.currentPeriodEndsAt), Number(s.cancelAtPeriodEnd),
        eventId, eventCreated, now, now, now, expectedVersion, s.organizationId, expectedVersion, eventCreated),
    addonWrite,
    database.prepare(`UPDATE stripe_billing_events SET organization_id = ?, status = 'processed', processed_at = ?
      WHERE event_id = ? AND EXISTS (SELECT 1 FROM tenant_subscriptions WHERE organization_id = ? AND last_stripe_event_id = ?)`)
      .bind(s.organizationId, now, eventId, s.organizationId, eventId),
  ]);
  if (Number(saved.meta.changes) > 0) return "synchronized" as const;
  const latest = await database.prepare("SELECT last_stripe_event_created_at created FROM tenant_subscriptions WHERE organization_id = ?")
    .bind(s.organizationId).first<{ created: number | null }>();
  if (latest?.created && latest.created > eventCreated) return "stale" as const;
  throw new ApiError(409, "STRIPE_BILLING_SYNC_CONFLICT", "Subscription access changed during synchronization. Stripe should retry this event.");
}
