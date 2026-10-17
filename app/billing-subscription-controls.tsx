"use client";

type Props = {
  current: { plan?: string | null; status: string | null; trialEndsAt?: string | null; currentPeriodEndsAt?: string | null; cancelAtPeriodEnd?: boolean; addons?: string[] };
  busy: boolean;
  onManage: () => void;
  onCancel: () => void;
  onRefresh: () => void;
};

function dateLabel(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}

export function BillingStatusRecovery({ message, stale = false, busy, onRetry }: { message: string; stale?: boolean; busy: boolean; onRetry: () => void }) {
  return <div className="billing-status-recovery" role="alert"><p>{message}</p>
    {stale && <p><strong>Last verified status shown.</strong> The latest billing status could not be confirmed. Refresh it or review the current status in Stripe.</p>}
    <button type="button" disabled={busy} onClick={onRetry}>{busy ? "Checking status…" : "Try again"}</button>
  </div>;
}

export default function BillingSubscriptionControls({ current, busy, onManage, onCancel, onRefresh }: Props) {
  const scheduled = current.cancelAtPeriodEnd === true;
  const trial = current.status === "trialing";
  const ending = dateLabel(scheduled ? current.currentPeriodEndsAt ?? current.trialEndsAt : trial ? current.trialEndsAt : current.currentPeriodEndsAt);
  return <section className="billing-subscription-controls" aria-label="Subscription management">
    <div><p className="billing-plan-badge">YOUR SUBSCRIPTION</p><h3>{scheduled ? "Cancellation scheduled" : "Manage or cancel your subscription"}</h3>
      <p>{scheduled ? ending ? `Recorded subscription end: ${ending}.` : "Stripe has confirmed a scheduled cancellation. Review the effective date in Stripe." : ending ? `${trial ? "Trial ends / first billing date" : "Recorded renewal date"}: ${ending}.` : "Review the current billing status and effective date in Stripe."}</p>
      <p>{scheduled ? "Your existing access follows the recorded subscription status until cancellation takes effect. You can review cancellation options in Stripe." : "Cancel subscription opens Stripe's confirmation page. Review the effective date there before confirming. Opening the page does not cancel your subscription."}</p>
      {trial && !scheduled && <p>Confirm cancellation before the trial ends to avoid the first subscription charge.</p>}
      {current.plan !== "bookloq" && current.addons?.includes("bookloq") && <p>Canceling this subscription also ends its BookLoQ add-on.</p>}
      <p>Your account and workspace records are retained. Permanent deletion is a separate action in Account &amp; login.</p>
    </div>
    <div className="billing-subscription-actions">
      <button type="button" className="primary" disabled={busy} onClick={onManage}>{busy ? "Please wait…" : scheduled ? "Review cancellation in Stripe" : "Manage billing in Stripe"}</button>
      {!scheduled && <button type="button" className="billing-cancel-button" disabled={busy} onClick={onCancel}>Cancel subscription</button>}
      <button type="button" disabled={busy} onClick={onRefresh}>Refresh status</button>
    </div>
    <p className="billing-subscription-help">Status updates after Stripe confirms the change. If billing cannot open, <a href="/contact">contact billing support</a>.</p>
  </section>;
}
