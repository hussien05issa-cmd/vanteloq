// Isolated presentation review. All displayed records are fictional.
import { act, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import DecisionCardsPanel from "../../app/decision-cards-panel";
import ProductBrandLogo from "../../app/product-brand-logo";
import VanteloqAiLogo from "../../app/vanteloq-ai-logo";
import type { DecisionCard } from "../../domain/decision-cards";
import { createWorkspaceAppearanceStore, useWorkspaceAppearance, WorkspaceAppearanceBoundary, WorkspaceAppearanceControl, type WorkspaceAppearance } from "../../app/workspace-appearance";
import "../../app/bookloq-collections.css";
import "../../app/workspace-base-styles";
import "../../app/workspace-styles";
import "../../app/readability-refinement.css";
import "../../app/sidebar-polish.css";
import "../../app/workspace-appearance.css";
import "../../app/workspace-contrast.css";
import "../../app/advisor-appearance.css";
import "../../app/premium-tokens.css";
import "../../app/premium-workspace.css";

let saved: WorkspaceAppearance = "dark", deviceDark = true;
const deviceListeners = new Set<() => void>();
const store = createWorkspaceAppearanceStore({
  read: () => saved, write: value => { saved = value; }, systemDark: () => deviceDark,
  subscribeSystem: listener => { deviceListeners.add(listener); return () => deviceListeners.delete(listener); },
  subscribeStorage: () => () => {},
});
const card: DecisionCard = {
  id: "theme-fixture-bill", kind: "bills_due", title: "Which bills need cash this week?", status: "recorded",
  value: { amount: 124000, currency: "CAD", unit: "minor_currency" }, summary: "Review the fictional open bills against recorded cash before choosing a payment.",
  evidence: { asOf: "2026-10-11", period: { from: "2026-10-05", to: "2026-10-11" }, sources: [{ system: "Fictional bill records", currency: "CAD", recordIds: ["theme-fixture-bill"], recordCount: 1, referencesTruncated: false }], formula: "Sum of open balances due through the selected period.", limitations: ["Fictional visual review. No business data is requested or changed."] },
  action: { label: "Review cash commitments", destination: "BookLoQ" }, missingFields: [],
};
const root = createRoot(document.getElementById("root")!);
function Preview() {
  const appearance = useWorkspaceAppearance(store);
  const [panel, setPanel] = useState(false), [notice, setNotice] = useState("");
  return <main className="operating-shell theme-review-preview" data-workspace-theme={appearance.theme}>
    <aside className="sidebar"><div className="theme-fixture-brand"><ProductBrandLogo product="vanteloq" priority/><span>Vanteloq</span></div><div className="nav-group"><p>Business</p><button className="nav-item active" aria-current="page">Overview</button><button className="nav-item">Sales</button><button className="nav-item">Inventory</button><button className="nav-item bookloq-main-nav">BookLoQ</button></div><div className="nav-group"><p>Team</p><button className="nav-item">Tasks</button><button className="nav-item">Messages</button></div><div className="side-bottom"><button className="profile-signout">Sign out</button></div></aside>
    <div className="theme-fixture-content"><header><p>Local review · Fictional records</p><h1>Your business, at a glance.</h1><p>Actual workspace themes and controls. This page sends no data requests.</p></header>
      <WorkspaceAppearanceControl store={store}/>
      <nav className="theme-fixture-tools"><button onClick={() => { deviceDark = !deviceDark; for (const listener of deviceListeners) listener(); }}>Preview device {deviceDark ? "light" : "dark"}</button><button onClick={() => setPanel(true)}>Open metric details</button><button onClick={() => void verify()}>Run theme checks</button></nav>
      <section className="theme-fixture-grid">
        <article className="business-workflow-detail"><header><h3>Sales performance</h3><span className="source-pill current"><i/>Updated today</span></header><dl className="business-workflow-metrics"><div><dt>Net revenue</dt><dd>CAD $12,400.00</dd><small className="positive">↑ 8.4% compared with the previous period</small></div><div><dt>Gross margin</dt><dd>36.0%</dd><small className="negative">↓ 1.7 percentage points</small></div></dl><p className="business-workflow-note">Source period: October 5 to 11, 2026.</p><button className="business-workflow-primary" onClick={() => setPanel(true)}>Review source records</button></article>
        <article className="business-workflow-detail"><h3>Purchasing</h3><p className="business-workflow-attention">Review supplier commitments before placing this order.</p><div className="business-workflow-state" data-state="completed">Reviewed</div><label>Supplier<input defaultValue="Fictional supplier"/></label><button disabled>Posting unavailable in this preview</button></article>
      </section>
      <DecisionCardsPanel cards={[card]} onEvidence={() => setPanel(true)} onAction={() => { setNotice("Preview selected. No records were changed."); }}/>
      <section className="bq-collection-panel bq-collections"><header className="theme-fixture-bookloq"><ProductBrandLogo product="bookloq" variant="full"/><h3>Invoices and bills</h3></header><div className="bq-record-table-wrap"><table><thead><tr><th>Document</th><th>Contact</th><th>Status</th><th>Outstanding</th></tr></thead><tbody><tr><td>INV-FICTIONAL-01</td><td>Fictional customer</td><td><span className="bq-status-pill overdue">Overdue</span></td><td>CAD $560.00</td></tr></tbody></table></div></section>
      <section className="settings-form billing-settings"><h3>Billing and subscription</h3><p>Fictional settings presentation. No subscription actions are available.</p><div className="billing-subscription-actions"><button className="primary" disabled>Manage subscription</button><button className="billing-cancel-button" disabled>Cancel subscription</button></div></section>
      <section className="ai-studio" data-ai-theme={appearance.theme}><header className="ai-studio-header"><VanteloqAiLogo size={36} decorative/><h3>Vanteloq AI</h3></header><div className="advisor-answer"><div className="ai-answer-content"><p>Revenue increased in these fictional records, while gross margin declined.</p><p>Review product costs and discounts before choosing a response.</p></div><p className="ai-submit-help">The preview does not send an AI request.</p><button className="ai-attach-button" disabled>Add a file</button></div></section>
      <p role="status">{notice}</p>
    </div>
    {panel && createPortal(<WorkspaceAppearanceBoundary store={store}><div className="control-surface-backdrop"><section className="control-surface" role="dialog" aria-modal="true" aria-labelledby="theme-fixture-dialog"><header className="control-surface-heading"><h2 id="theme-fixture-dialog">Source records</h2><button className="surface-close" aria-label="Close source records" onClick={() => setPanel(false)}>×</button></header><div className="control-surface-content"><div className="pulse-status"><i/><div><strong>Review due bills</strong><p>The source period and records stay attached.</p></div></div><DecisionCardsPanel cards={[card]}/></div></section></div></WorkspaceAppearanceBoundary>, document.body)}
  </main>;
}

function rgb(value: string) { const parts = value.match(/[\d.]+/g)?.map(Number); if (!parts || parts.length < 3) throw new Error(`Unsupported colour ${value}`); return parts.slice(0, 3); }
function luminance(colour: number[]) { const linear = colour.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2]; }
function ratio(element: Element) {
  const foreground = luminance(rgb(getComputedStyle(element).color));
  let parent: Element | null = element;
  while (parent && /(?:rgba\([^)]*,\s*0\)|transparent)/.test(getComputedStyle(parent).backgroundColor)) parent = parent.parentElement;
  if (!parent) throw new Error("No opaque working surface");
  const background = luminance(rgb(getComputedStyle(parent).backgroundColor));
  return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
}
async function settleAppearanceMotion() {
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const finiteAnimations = document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity));
  await Promise.all(finiteAnimations.map(animation => animation.finished.catch(() => undefined)));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}
async function verify() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const results: { name: string; passed: boolean; error?: string }[] = [];
  const check = async (name: string, run: () => void | Promise<void>) => { try { await run(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error instanceof Error ? error.message : "Review failed" }); } };
  const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  await act(async () => root.render(<Preview/>));
  for (const mode of ["dark", "light"] as const) {
    await act(async () => store.choose(mode));
    await settleAppearanceMotion();
    await check(`${mode}: readable records, controls, feedback and AI`, () => {
      for (const selector of [".nav-item.active", ".business-workflow-metrics dt", ".business-workflow-metrics dd", ".positive", ".negative", ".business-workflow-note", ".business-workflow-attention", ".business-workflow-primary", ".source-decision-value", ".source-decision-card p", ".bq-status-pill.overdue", ".bq-record-table-wrap th", ".bq-record-table-wrap td", ".ai-answer-content p", ".ai-submit-help"]) {
        const elements = document.querySelectorAll(selector); assert(elements.length > 0, `Missing ${selector}`);
        for (const element of elements) {
          const value = ratio(element); assert(value >= 4.5, `${selector} contrast ${value.toFixed(3)}`);
        }
      }
    });
    await check(`${mode}: opaque financial cards and quiet status`, () => {
      const card = document.querySelector(".source-decision-card")!, detail = document.querySelector(".business-workflow-detail")!;
      assert(getComputedStyle(card).backgroundColor === getComputedStyle(detail).backgroundColor, "Lazy decision panel restored a legacy colour");
      assert(getComputedStyle(document.querySelector(".source-pill>i")!).display === "none", "Decorative source dot remains");
      const header = document.querySelector(".bq-record-table-wrap th")!.getBoundingClientRect();
      const cell = document.querySelector(".bq-record-table-wrap td")!.getBoundingClientRect();
      assert(header.bottom <= cell.top + .5, `Table header overlaps the first data row (${header.bottom.toFixed(2)}/${cell.top.toFixed(2)})`);
    });
    await act(async () => document.querySelector<HTMLButtonElement>(".theme-fixture-tools button:nth-child(2)")!.click());
    await check(`${mode}: metric portal shares the selected appearance`, () => {
      const boundary = document.querySelector(".workspace-theme-scope"); assert(boundary?.getAttribute("data-workspace-theme") === mode, "Portal retained an old theme");
      assert(ratio(document.querySelector(".control-surface h2")!) >= 4.5, "Portal heading contrast");
      assert(getComputedStyle(document.querySelector(".pulse-status>i")!).display === "none", "Decorative Pulse dot remains");
    });
    await act(async () => document.querySelector<HTMLButtonElement>(".surface-close")!.click());
    await check(`${mode}: closing the portal returns to the same records`, () => { assert(!document.querySelector(".control-surface"), "Portal did not close"); assert(document.querySelector(".source-decision-value")?.textContent?.includes("1,240.00"), "Records changed during close"); });
  }
  await act(async () => store.choose("system"));
  await check("System follows the device while an explicit selection stays fixed", async () => {
    await act(async () => { deviceDark = false; for (const listener of deviceListeners) listener(); });
    assert(document.querySelector("main")?.getAttribute("data-workspace-theme") === "light", "System did not follow Light");
    await act(async () => store.choose("dark"));
    await act(async () => { deviceDark = false; for (const listener of deviceListeners) listener(); });
    assert(document.querySelector("main")?.getAttribute("data-workspace-theme") === "dark", "Device overrode explicit Dark");
  });
  await check("Data remains inside a narrow mobile column", async () => {
    const host = document.querySelector<HTMLElement>("main")!;
    host.style.width = "360px"; host.style.maxWidth = "100%"; host.style.gridTemplateColumns = "minmax(0,1fr)";
    document.querySelector<HTMLElement>(".sidebar")!.style.setProperty("display", "none", "important");
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    assert(host.scrollWidth <= host.clientWidth + 1, `Layout overflow ${host.scrollWidth}/${host.clientWidth}`);
  });
  await act(async () => root.render(<main className="theme-review-results"><h1>Midnight theme review</h1><p>{results.filter(item => item.passed).length} of {results.length} checks passed.</p><ul>{results.map(item => <li key={item.name}>{item.passed ? "PASS" : "FAIL"}: {item.name}{item.error ? ` (${item.error})` : ""}</li>)}</ul><button onClick={() => root.render(<Preview/>)}>Return to the visual review</button></main>));
  document.documentElement.dataset.midnightThemeTests = results.every(item => item.passed) ? "passed" : "failed";
}
if (new URLSearchParams(location.search).has("test")) void verify(); else root.render(<Preview/>);
