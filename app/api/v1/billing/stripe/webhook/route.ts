import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { stripeBillingEvents, tenantAddons, tenantSubscriptions } from "../../../../../../db/schema";
import { ApiError, handleApi, jsonResponse, readRequestBytes } from "../../../../../../server/api";
import {
  normalizeStripeSubscription,
  retrieveStripeSubscription,
  sha256Hex,
  verifyStripeBillingSignature,
} from "../../../../../../server/billing/stripe";

const MAXIMUM_BYTES = 256_000;

export async function POST(request: Request) {
  return handleApi(request, async () => {
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) throw new ApiError(415, "STRIPE_BILLING_CONTENT_TYPE", "Stripe Billing webhook content type is invalid.");
    const bytes = await readRequestBytes(request, MAXIMUM_BYTES, "STRIPE_BILLING_WEBHOOK_TOO_LARGE", "The Stripe Billing webhook is too large.");
    if (bytes.length > MAXIMUM_BYTES) throw new ApiError(413, "STRIPE_BILLING_WEBHOOK_TOO_LARGE", "The Stripe Billing webhook is too large.");
    if (!(await verifyStripeBillingSignature(bytes, request.headers.get("stripe-signature")))) throw new ApiError(401, "STRIPE_BILLING_SIGNATURE_INVALID", "The Stripe Billing webhook signature is invalid or expired.");
    let event: Record<string, unknown>;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      event = parsed as Record<string, unknown>;
    } catch { throw new ApiError(400, "STRIPE_BILLING_PAYLOAD_INVALID", "The Stripe Billing webhook payload is invalid."); }
    const eventId = typeof event.id === "string" ? event.id : "";
    const eventType = typeof event.type === "string" ? event.type : "";
    const eventCreated = typeof event.created === "number" ? event.created : 0;
    if (!/^evt_[A-Za-z0-9]{8,128}$/.test(eventId) || !eventType || eventType.length > 120 || !Number.isSafeInteger(eventCreated) || eventCreated <= 0) throw new ApiError(400, "STRIPE_BILLING_PAYLOAD_INVALID", "The Stripe Billing event envelope is invalid.");
    const now = new Date();
    await getDb().insert(stripeBillingEvents).values({
      eventId, organizationId: null, eventType, stripeCreatedAt: new Date(eventCreated * 1000), payloadHash: await sha256Hex(bytes), status: "received", errorCode: null, receivedAt: now, processedAt: null,
    }).onConflictDoNothing();
    const claimed = await getDb().update(stripeBillingEvents).set({ status: "processing", errorCode: null, receivedAt: now })
      .where(and(eq(stripeBillingEvents.eventId, eventId), inArray(stripeBillingEvents.status, ["received", "failed"])))
      .returning({ eventId: stripeBillingEvents.eventId });
    if (!claimed.length) return jsonResponse({ received: true, duplicate: true });
    try {
      const data = event.data && typeof event.data === "object" && !Array.isArray(event.data) ? event.data as Record<string, unknown> : {};
      const object = data.object && typeof data.object === "object" && !Array.isArray(data.object) ? data.object as Record<string, unknown> : {};
      const subscriptionId = eventType.startsWith("customer.subscription.")
        ? (typeof object.id === "string" ? object.id : "")
        : eventType === "checkout.session.completed" && typeof object.subscription === "string" ? object.subscription : "";
      if (!subscriptionId) {
        await getDb().update(stripeBillingEvents).set({ status: "ignored", processedAt: new Date() }).where(eq(stripeBillingEvents.eventId, eventId));
        return jsonResponse({ received: true, ignored: true });
      }
      const normalized = normalizeStripeSubscription(await retrieveStripeSubscription(subscriptionId));
      const [current] = await getDb().select().from(tenantSubscriptions).where(eq(tenantSubscriptions.organizationId, normalized.organizationId)).limit(1);
      if (current?.lastStripeEventCreatedAt && current.lastStripeEventCreatedAt.getTime() > eventCreated * 1000) {
        await getDb().update(stripeBillingEvents).set({ organizationId: normalized.organizationId, status: "ignored", processedAt: new Date() }).where(eq(stripeBillingEvents.eventId, eventId));
        return jsonResponse({ received: true, stale: true });
      }
      const syncedAt = new Date();
      await getDb().insert(tenantSubscriptions).values({
        organizationId: normalized.organizationId, basePlan: normalized.basePlan, billingInterval: normalized.billingInterval, status: normalized.status,
        stripeCustomerId: normalized.customerId, stripeSubscriptionId: normalized.subscriptionId, stripeBasePriceId: normalized.basePriceId,
        trialEndsAt: normalized.trialEndsAt, currentPeriodEndsAt: normalized.currentPeriodEndsAt, cancelAtPeriodEnd: normalized.cancelAtPeriodEnd,
        scheduledBasePlan: null, scheduledBillingInterval: null, scheduledEffectiveAt: null, lastStripeEventId: eventId,
        lastStripeEventCreatedAt: new Date(eventCreated * 1000), lastSyncedAt: syncedAt, version: (current?.version ?? 0) + 1,
        createdAt: current?.createdAt ?? syncedAt, updatedAt: syncedAt,
      }).onConflictDoUpdate({ target: tenantSubscriptions.organizationId, set: {
        basePlan: normalized.basePlan, billingInterval: normalized.billingInterval, status: normalized.status,
        stripeCustomerId: normalized.customerId, stripeSubscriptionId: normalized.subscriptionId, stripeBasePriceId: normalized.basePriceId,
        trialEndsAt: normalized.trialEndsAt, currentPeriodEndsAt: normalized.currentPeriodEndsAt, cancelAtPeriodEnd: normalized.cancelAtPeriodEnd,
        scheduledBasePlan: null, scheduledBillingInterval: null, scheduledEffectiveAt: null, lastStripeEventId: eventId,
        lastStripeEventCreatedAt: new Date(eventCreated * 1000), lastSyncedAt: syncedAt, version: (current?.version ?? 0) + 1, updatedAt: syncedAt,
      } });
      const addonActive = normalized.addon && ["active", "trialing"].includes(normalized.status);
      const addonRow = normalized.addon;
      await getDb().insert(tenantAddons).values({
        id: crypto.randomUUID(), organizationId: normalized.organizationId, addonKey: "bookloq", status: addonActive ? normalized.status as "active" | "trialing" : "inactive",
        stripeSubscriptionItemId: addonRow?.itemId ?? null, stripePriceId: addonRow?.priceId ?? null, currentPeriodEndsAt: addonRow?.currentPeriodEndsAt ?? null,
        scheduledRemovalAt: null, lastSyncedAt: syncedAt, createdAt: syncedAt, updatedAt: syncedAt,
      }).onConflictDoUpdate({ target: [tenantAddons.organizationId, tenantAddons.addonKey], set: {
        status: addonActive ? normalized.status as "active" | "trialing" : "inactive", stripeSubscriptionItemId: addonRow?.itemId ?? null,
        stripePriceId: addonRow?.priceId ?? null, currentPeriodEndsAt: addonRow?.currentPeriodEndsAt ?? null, scheduledRemovalAt: null, lastSyncedAt: syncedAt, updatedAt: syncedAt,
      } });
      await getDb().update(stripeBillingEvents).set({ organizationId: normalized.organizationId, status: "processed", processedAt: syncedAt }).where(eq(stripeBillingEvents.eventId, eventId));
      return jsonResponse({ received: true, synchronized: true });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "STRIPE_BILLING_SYNC_FAILED";
      await getDb().update(stripeBillingEvents).set({ status: "failed", errorCode: code, processedAt: new Date() }).where(eq(stripeBillingEvents.eventId, eventId));
      throw error;
    }
  });
}
