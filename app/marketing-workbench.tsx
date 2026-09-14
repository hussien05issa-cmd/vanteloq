"use client";

import { useMemo, useState, type FormEvent } from "react";
import { buildCampaignLink, marketingReviewGuides, type MarketingPlanDraft } from "../domain/marketing-workbench";
import WorkspaceIcon from "./workspace-icon";
import { FieldLabel } from "./form-primitives";

export type JourneyCoverage = {
  journeys: number; stages: Record<"discovery" | "website" | "contact" | "customer" | "purchase", number>;
  matchedTransactions: number; unmatchedTransactions: number; limited: boolean; revenueAvailable: boolean;
};

export function JourneyCoverageCard({ coverage, period, onImport }: { coverage: JourneyCoverage | null; period: { since: string; through: string }; onImport: () => void }) {
  const stages = [["discovery", "Discovered you"], ["website", "Visited your site"], ["contact", "Made contact"], ["customer", "Recorded customer"], ["purchase", "Matched purchase"]] as const;
  const maximum = Math.max(1, ...stages.map(([key]) => coverage?.stages[key] ?? 0));
  return <section className="mw-card mw-journey" aria-labelledby="journey-coverage-title">
    <header><div><p className="mw-kicker">CUSTOMER JOURNEY COVERAGE</p><h3 id="journey-coverage-title">See where the evidence stops.</h3></div><button type="button" onClick={onImport}>Review journey data →</button></header>
    <p>Distinct journey references with a recorded event at each stage. These are coverage counts, not a conversion funnel: people can skip stages, and missing events are not lost customers.</p>
    {!coverage || !coverage.journeys ? <div className="mw-empty"><WorkspaceIcon name="Customers"/><div><strong>{coverage ? "No recorded journeys yet" : "Organization-wide access required"}</strong><p>{coverage ? "Connect or import consented touchpoints and matched sales. Aggregate website traffic alone cannot identify a customer's purchase." : "This view does not expose organization-wide journey records to location-restricted accounts."}</p></div></div> : <div className="mw-stage-bars">{stages.map(([key, title]) => <div key={key}><span>{title}</span><div aria-hidden="true"><i style={{ width: `${coverage.stages[key] / maximum * 100}%` }}/></div><b>{key === "purchase" && !coverage.revenueAvailable ? "Restricted" : coverage.stages[key].toLocaleString("en-CA")}</b></div>)}</div>}
    <footer><span>{period.since} to {period.through} · Organization records, not location conversion rates.</span>{coverage?.revenueAvailable && <span>{coverage.matchedTransactions} matched transactions · {coverage.unmatchedTransactions} without an earlier matching touchpoint</span>}{coverage?.limited && <strong>Record limit reached. These counts cover the returned sample, not the complete period.</strong>}</footer>
  </section>;
}

export default function MarketingWorkbench({ canManage, website, onPlan, onReports }: { canManage: boolean; website: string; onPlan: (draft: MarketingPlanDraft) => void; onReports: () => void }) {
  const [destination, setDestination] = useState(website), [source, setSource] = useState("instagram"), [medium, setMedium] = useState("social");
  const [campaign, setCampaign] = useState(""), [content, setContent] = useState(""), [copyStatus, setCopyStatus] = useState("");
  const [linkRequested, setLinkRequested] = useState(false);
  const link = useMemo(() => buildCampaignLink({ destination, source, medium, campaign, content }), [destination, source, medium, campaign, content]);
  const [planError, setPlanError] = useState("");
  const preparePlan = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const value = (name: string) => String(fields.get(name) ?? "").trim();
    if (!["title", "audience", "outcome", "metric", "review"].every((name) => value(name))) { setPlanError("Complete the campaign goal, audience, measurement and review method."); return; }
    setPlanError("");
    onPlan({ title: value("title"), channel: value("channel") as MarketingPlanDraft["channel"], eventType: "campaign", objective: `Outcome: ${value("outcome")}\nMeasure: ${value("metric")}`, notes: `Audience: ${value("audience")}\nOwner: ${value("owner") || "Assign before starting"}\nBaseline: ${value("baseline") || "Not recorded; establish before launch"}\nReview: ${value("review")}\nCheck stock, margin, capacity and consent before launch. This plan does not publish content or change ad spend.` });
  };
  return <div className="mw-workbench">
    <section className="mw-intro"><div><p className="mw-kicker">PLAN. MEASURE. LEARN.</p><h3>One focused plan across your channels.</h3><p>Give each campaign one audience, one business outcome and a review date. Reuse the idea across relevant channels; do not confuse being everywhere with making progress.</p></div><button type="button" onClick={onReports}>Explore source reports →</button></section>
    <div className="mw-two-column">
      <form className="mw-card" onSubmit={preparePlan}>
        <header><div><p className="mw-kicker">CAMPAIGN BRIEF</p><h3>Turn an idea into accountable work.</h3></div><WorkspaceIcon name="Action Centre"/></header>
        <div className="mw-fields">
          <label className="mw-wide"><FieldLabel>Campaign Name</FieldLabel><input name="title" maxLength={180} required placeholder="Autumn product education"/></label>
          <label>Primary channel<select name="channel" defaultValue="content"><option value="content">Content and social</option><option value="google">Google</option><option value="meta">Meta (planning only)</option><option value="email">Email</option><option value="local">Local discovery</option><option value="website">Website</option></select></label>
          <label>Responsible person<input name="owner" maxLength={80} placeholder="Name or team role"/></label>
          <label className="mw-wide"><FieldLabel>Who Is This for?</FieldLabel><input name="audience" maxLength={120} required placeholder="Customers comparing their first purchase"/></label>
          <label className="mw-wide"><FieldLabel>Business Outcome</FieldLabel><input name="outcome" maxLength={200} required placeholder="More qualified enquiries for this offer"/></label>
          <label><FieldLabel>Success Metric</FieldLabel><input name="metric" maxLength={160} required placeholder="Qualified enquiries, not likes"/></label>
          <label>Current baseline<input name="baseline" maxLength={120} placeholder="Value, source and date range"/></label>
          <label className="mw-wide"><FieldLabel>How Will You Review the Result?</FieldLabel><textarea name="review" maxLength={280} required placeholder="Compare the same source and period. Record spend, sales context, what changed and what remains uncertain."/></label>
        </div>
        {planError && <p role="alert" className="mw-error">{planError}</p>}
        <footer><p>Next, review the draft and choose dates in the calendar. Nothing is saved or published yet.</p><button type="submit" disabled={!canManage}>Review calendar draft →</button>{!canManage && <small>Organization-wide owner or admin permission is required to create plans.</small>}</footer>
      </form>
      <section className="mw-card">
        <header><div><p className="mw-kicker">CONSISTENT CAMPAIGN LINKS</p><h3>Know which channel brought the visit.</h3></div><WorkspaceIcon name="Integrations"/></header>
        <p>Create a tagged link for external campaigns. Use the same campaign name across platforms and a different source for each. Your website still needs consent-aware Analytics configuration.</p>
        <form onSubmit={(event) => { event.preventDefault(); setLinkRequested(true); setCopyStatus(""); }}>
          <div className="mw-fields">
            <label className="mw-wide"><FieldLabel>Public Landing Page</FieldLabel><input type="url" value={destination} onChange={(event) => { setDestination(event.target.value); setCopyStatus(""); }} maxLength={1400} required placeholder="https://yourbusiness.com/offer"/></label>
            <label><FieldLabel>Source</FieldLabel><input value={source} onChange={(event) => { setSource(event.target.value); setCopyStatus(""); }} maxLength={80} required list="campaign-sources"/><datalist id="campaign-sources"><option value="instagram"/><option value="facebook"/><option value="youtube"/><option value="tiktok"/><option value="newsletter"/><option value="google"/></datalist></label>
            <label>Medium<select value={medium} onChange={(event) => { setMedium(event.target.value); setCopyStatus(""); }}><option value="social">Organic social</option><option value="paid_social">Paid social</option><option value="email">Email</option><option value="referral">Referral</option><option value="cpc">Paid search</option><option value="qr">Offline QR campaign</option></select></label>
            <label><FieldLabel>Campaign</FieldLabel><input value={campaign} onChange={(event) => { setCampaign(event.target.value); setCopyStatus(""); }} required maxLength={80} placeholder="autumn_education"/></label>
            <label><FieldLabel required={false}>Creative Label</FieldLabel><input value={content} onChange={(event) => { setContent(event.target.value); setCopyStatus(""); }} maxLength={80} placeholder="product_video"/></label>
          </div><button type="submit">Build campaign link</button>
        </form>
        {linkRequested && (link.error ? <p className="mw-error" role="alert">{link.error}</p> : <div className="mw-link-result"><label>Campaign URL<textarea readOnly value={link.url ?? ""} onFocus={(event) => event.target.select()}/></label><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(link.url!); setCopyStatus("Campaign link copied."); } catch { setCopyStatus("Clipboard unavailable. Select the URL and copy it manually."); } }}>Copy link</button><p role="status">{copyStatus}</p></div>)}
        <footer><p>No tracking is installed or sent by this builder. Never put customer names, email addresses, tokens or confidential details in a campaign URL. Do not tag internal links or replace an existing provider&apos;s automatic tagging without reviewing its setup.</p><a href="https://support.google.com/analytics/answer/10917952?hl=en" target="_blank" rel="noreferrer">Google Analytics campaign guidance ↗</a></footer>
      </section>
    </div>
    <section className="mw-review" aria-labelledby="marketing-review-heading"><header><div><p className="mw-kicker">KEEP YOUR APPROACH CURRENT</p><h3 id="marketing-review-heading">A review routine, not another trend to chase.</h3></div><span>Guidance reviewed September 8, 2026</span></header><p>This is a dated checklist, not a live platform-change feed. Check the linked provider guidance before making changes.</p><div className="mw-review-grid">{marketingReviewGuides.map((guide) => <article className="mw-card" key={guide.id}><small>{guide.cadence}</small><h4>{guide.title}</h4><p>{guide.detail}</p><details><summary>What to measure</summary><p>{guide.measure}</p></details><a href={guide.url} target="_blank" rel="noreferrer">{guide.source} ↗</a><button type="button" disabled={!canManage} onClick={() => onPlan({ title: guide.title, channel: guide.channel, eventType: "audit", objective: guide.measure, notes: `Review cadence: ${guide.cadence}\nGuidance reviewed 2026-09-08. Check the current source: ${guide.url}\nRecord your findings and next action. This is a manual review, not an automated recurring task.` })}>Plan this review →</button></article>)}</div></section>
  </div>;
}
