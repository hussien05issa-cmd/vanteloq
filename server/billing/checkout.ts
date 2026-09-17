import { getD1 } from "../../db";
import { ApiError } from "../api";
import { prepareStripeCheckout, submitStripeCheckout, retrieveStripeCheckout, expireStripeCheckout } from "./stripe";

type Attempt = { organization_id: string; attempt_id: string; selection_key: string; request_body: string; session_id: string | null; created_at: number };
type Selection = Parameters<typeof prepareStripeCheckout>[0];
const pending = () => new ApiError(409, "CHECKOUT_PENDING", "Your previous checkout is still being confirmed. Try again shortly. If this continues, contact support before starting another payment.");
const completed = () => new ApiError(409, "CHECKOUT_COMPLETED", "Your payment is being confirmed. Refresh your workspace instead of paying again.");

async function readAttempt(database: D1Database, organizationId: string) {
  return database.prepare("SELECT * FROM billing_checkout_attempts WHERE organization_id=?").bind(organizationId).first<Attempt>();
}

async function resolveSession(database: D1Database, row: Attempt, fetcher: typeof fetch, now: number) {
  let sessionId = row.session_id;
  if (!sessionId) {
    // Unknown outcomes are never replaced on a timer. Stripe may have accepted a payment.
    // Stop retries well before its 24-hour idempotency retention boundary.
    if (now - row.created_at >= 23 * 3600) throw pending();
    const created = await submitStripeCheckout(new URLSearchParams(row.request_body), row.attempt_id, fetcher);
    if (typeof created.id !== "string") throw pending();
    sessionId = created.id;
    const session = await retrieveStripeCheckout(sessionId, fetcher);
    if (session.id !== sessionId || session.client_reference_id !== row.organization_id || (session.metadata as Record<string, unknown> | undefined)?.vanteloq_checkout_attempt !== row.attempt_id) throw pending();
    const saved = await database.prepare("UPDATE billing_checkout_attempts SET session_id=? WHERE organization_id=? AND attempt_id=? AND (session_id IS NULL OR session_id=?) RETURNING attempt_id")
      .bind(sessionId, row.organization_id, row.attempt_id, sessionId).first();
    if (!saved) throw pending();
    return session;
  }
  const session = await retrieveStripeCheckout(sessionId, fetcher);
  if (session.id !== sessionId || session.client_reference_id !== row.organization_id || (session.metadata as Record<string, unknown> | undefined)?.vanteloq_checkout_attempt !== row.attempt_id) throw pending();
  return session;
}

export async function startStripeCheckout(input: Selection & { userId: string; database?: D1Database; now?: number }) {
  const database = input.database ?? getD1();
  const fetcher = input.fetcher ?? fetch;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const selectionKey = `${input.plan}:${input.interval}:${input.includeBookloq ? "bookloq" : "base"}`;
  for (let retry = 0; retry < 3; retry++) {
    const subscription = await database.prepare("SELECT stripe_subscription_id,status FROM tenant_subscriptions WHERE organization_id=?").bind(input.organizationId).first<{stripe_subscription_id:string|null;status:string}>();
    if (subscription?.stripe_subscription_id && !["canceled", "incomplete_expired"].includes(subscription.status)) throw new ApiError(409, "BILLING_PORTAL_REQUIRED", "Use Manage Billing to update your existing subscription.");
    let row = await readAttempt(database, input.organizationId);
    if (!row) {
      const attemptId = crypto.randomUUID();
      const fields = await prepareStripeCheckout(input);
      fields.set("expires_at", String(now + 3600));
      fields.set("metadata[vanteloq_checkout_attempt]", attemptId);
      fields.set("subscription_data[metadata][vanteloq_checkout_attempt]", attemptId);
      await database.prepare(`INSERT INTO billing_checkout_attempts (organization_id,attempt_id,selection_key,request_body,created_at)
        SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE id=?)
        AND NOT EXISTS(SELECT 1 FROM account_deletion_jobs WHERE stage<>'completed' AND (user_id=? OR (scope='workspace' AND organization_id=?)))
        AND NOT EXISTS(SELECT 1 FROM tenant_subscriptions WHERE organization_id=? AND stripe_subscription_id IS NOT NULL AND status NOT IN('canceled','incomplete_expired'))
        ON CONFLICT(organization_id) DO NOTHING`)
        .bind(input.organizationId, attemptId, selectionKey, fields.toString(), now, input.organizationId, input.userId, input.organizationId, input.organizationId).run();
      row = await readAttempt(database, input.organizationId);
      if (!row) throw pending();
    }
    let session = await resolveSession(database, row, fetcher, now);
    if (session.status === "complete") {
      // A previous canceled subscription may start again, but an unprocessed payment may not.
      if (!subscription?.stripe_subscription_id || session.subscription !== subscription.stripe_subscription_id || !["canceled", "incomplete_expired"].includes(subscription.status)) throw completed();
    } else if (session.status === "open" && row.selection_key !== selectionKey) {
      const resolvedId = String(session.id);
      session = await expireStripeCheckout(resolvedId, row.attempt_id, fetcher);
      if (session.status !== "expired" || session.id !== resolvedId) throw pending();
    } else if (session.status === "open") {
      const url = typeof session.url === "string" ? session.url : "";
      if (!url.startsWith("https://checkout.stripe.com/")) throw pending();
      const current = await database.prepare(`SELECT attempt_id FROM billing_checkout_attempts WHERE organization_id=? AND attempt_id=?
        AND NOT EXISTS(SELECT 1 FROM account_deletion_jobs WHERE stage<>'completed' AND (user_id=? OR (scope='workspace' AND organization_id=?)))
        AND NOT EXISTS(SELECT 1 FROM tenant_subscriptions WHERE organization_id=? AND stripe_subscription_id IS NOT NULL AND status NOT IN('canceled','incomplete_expired'))`)
        .bind(input.organizationId, row.attempt_id, input.userId, input.organizationId, input.organizationId).first();
      if (!current) throw pending();
      return { url };
    } else if (session.status !== "expired") throw pending();
    // Compare-and-delete: a concurrent changed selection cannot replace a newer attempt.
    await database.prepare("DELETE FROM billing_checkout_attempts WHERE organization_id=? AND attempt_id=?").bind(input.organizationId, row.attempt_id).run();
  }
  throw pending();
}

export async function closeCheckoutBeforeDeletion(organizationId: string, subscriptionId: string | null, database = getD1(), fetcher: typeof fetch = fetch) {
  const row = await readAttempt(database, organizationId);
  if (!row) return;
  let session = await resolveSession(database, row, fetcher, Math.floor(Date.now() / 1000));
  const resolvedId = String(session.id);
  if (session.status === "open") session = await expireStripeCheckout(resolvedId, row.attempt_id, fetcher);
  if (session.id !== resolvedId) throw pending();
  if (session.status !== "expired" && !(session.status === "complete" && session.subscription === subscriptionId && subscriptionId)) throw completed();
  // Retain the attempt until workspace erasure so an in-flight request cannot create another.
}
