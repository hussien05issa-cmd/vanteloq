import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ReportsPanel, type BookLoQData } from "../../app/bookloq-workspace";
import { ledgerIntelligence } from "../../domain/executive-metrics";
import type { BookloqDatedReport } from "../../server/bookloq-reports";

// Real React components with controlled fictional HTTP responses. Run through
// output/bookloq-focus-preview.mjs and inspect window.__bookloqFocusResults.
const runtime = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
  __bookloqFocusFetch?: (path: string) => Promise<Response>;
  __bookloqFocusResults?: { name: string; passed: boolean; error?: string }[];
};
runtime.IS_REACT_ACT_ENVIRONMENT = true;
const pending: { path: string; resolve: (response: Response) => void }[] = [];
runtime.__bookloqFocusFetch = path => {
  if (!path.startsWith("/api/v1/bookloq/reports?")) return Promise.reject(Error("Unexpected fixture endpoint"));
  return new Promise(resolve => pending.push({ path, resolve }));
};
const root = createRoot(document.getElementById("fixture")!);
const outside = document.getElementById("outside") as HTMLButtonElement;
const assert = (condition: unknown, message: string) => { if (!condition) throw Error(message); };
const button = (label: string) => {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label);
  if (!found) throw Error("Missing button: " + label);
  return found;
};
const click = async (label: string) => { await act(async () => { const target = button(label); target.focus(); target.click(); }); };
function data(path: string, organizationId = "org", detailAvailable = true, includeAccount = true): BookloqDatedReport {
  const accountId = new URL(path, location.origin).searchParams.get("accountId");
  const accounts = includeAccount ? [{ id: "sales", code: "4000", name: "Fictional sales revenue", accountType: "revenue", accountSubtype: "sales", systemKey: null, normalBalance: "credit", active: 1, debitCents: 0, creditCents: 12345, closingDebitCents: 0, closingCreditCents: 12345, periodBalanceCents: 12345, closingBalanceCents: 12345, lineCount: 1, closingLineCount: 1 }] : [];
  return { metadata: { organizationId, currency: "CAD", timeZone: "America/Edmonton", from: "2026-10-01", to: "2026-10-10", asOf: "2026-10-10", accountingBasis: "accrual", source: "posted_ledger", scope: "all_locations", dataMode: "demonstration", generatedAt: "2026-10-10T12:00:00Z", lastPostedAt: null, calculationVersion: "fixture", foreignEntryCount: 0, detailAvailable, boundary: "Fictional focus regression; no financial or provider writes." }, accounts,
    profitAndLoss: ledgerIntelligence(accounts), balanceSheet: { assetCents: 12345, liabilityCents: 0, equityCents: 12345, recordedEarningsCents: 12345, differenceCents: 0 }, trialBalance: { debitCents: 12345, creditCents: 12345, differenceCents: 0 }, coverage: { periodLineCount: 1, closingLineCount: 2 },
    detail: accountId ? { accountId, from: "2026-10-01", to: "2026-10-10", lines: [], nextCursor: null } : null };
}
async function respond(options: { organizationId?: string; detailAvailable?: boolean; includeAccount?: boolean } = {}) {
  const request = pending.shift(); assert(request, "Expected one pending report read");
  await act(async () => { request!.resolve(Response.json(data(request!.path, options.organizationId, options.detailAvailable, options.includeAccount))); });
}
async function render(organizationId = "org", exportAllowed = false) {
  const workspace = { organization: { id: organizationId, name: "Fictional workspace", currency: "CAD" }, settings: { status: "active", baseCurrency: "CAD", accountingBasis: "accrual", dataMode: "demonstration" }, locationScope: null, permissions: exportAllowed ? ["export_data"] : [], ledgerAccess: { available: true } } as unknown as BookLoQData;
  await act(async () => root.render(<ReportsPanel data={workspace} navigate={() => {}} canUploadDocuments={false} canViewDocuments={false} openStatementImport={() => {}}/>));
}
async function reset() { await act(async () => root.render(null)); pending.length = 0; outside.focus(); await render(); await respond(); }
async function open() { await click("Fictional sales revenue"); await respond(); }
const cases: [string, () => Promise<void>][] = [
  ["Close restores the originating account after the keyed reader and table are recreated", async () => {
    await reset(); const original = button("Fictional sales revenue"); await open();
    assert(!original.isConnected, "Fixture did not exercise the keyed table replacement");
    await click("Close account entries"); assert(document.activeElement === document.body, "Expected removed close button to leave body focused while loading");
    await respond(); assert(document.activeElement === button("Fictional sales revenue"), "Closing lost the originating account focus");
  }],
  ["A user who focuses another control during loading keeps focus", async () => {
    await reset(); await open(); await click("Close account entries"); outside.focus(); await respond();
    assert(document.activeElement === outside, "Report response stole deliberate focus");
  }],
  ["Changing the report while a closing response is pending cancels its focus target", async () => {
    await reset(); await open(); await click("Close account entries"); await click("Trial balance");
    const selected = button("Trial balance"); await respond(); await respond();
    assert(document.activeElement === selected, "Stale closing response stole report-selection focus");
  }],
  ["Workspace changes cannot restore focus into another business with the same account ID", async () => {
    await reset(); await open(); await click("Close account entries"); outside.focus(); await render("other");
    await respond(); await respond({ organizationId: "other" });
    assert(document.activeElement === outside, "Previous business restored focus in a different business");
  }],
  ["Applying dates during a closing read cancels the previous account focus target", async () => {
    await reset(); await open(); await click("Close account entries"); await click("Apply dates");
    const selected = button("Apply dates"); await respond(); await respond();
    assert(document.activeElement === selected, "The prior period restored account focus after applying dates");
  }],
  ["A missing account consumes the target so a later refresh cannot unexpectedly focus it", async () => {
    await reset(); await open(); await click("Close account entries"); await respond({ includeAccount: false });
    await click("Refresh report"); await respond();
    assert(document.activeElement !== button("Fictional sales revenue"), "A later refresh reused a missing account target");
  }],
  ["Revoked detail access disables the target and cannot leave a deferred focus jump", async () => {
    await reset(); await open(); await click("Close account entries"); await respond({ detailAvailable: false });
    assert(button("Fictional sales revenue").disabled, "Fixture must withdraw account detail access");
    assert(document.activeElement !== button("Fictional sales revenue"), "Disabled account received focus");
    await click("Refresh report"); await respond();
    assert(document.activeElement !== button("Fictional sales revenue"), "A later refresh reused the denied target");
  }],
];
const results: NonNullable<typeof runtime.__bookloqFocusResults> = [];
runtime.__bookloqFocusResults = results;
for (const [name, run] of cases) {
  try { await run(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) }); }
  document.getElementById("results")!.textContent = JSON.stringify(results, null, 2);
}
await act(async () => root.render(null));
document.getElementById("status")!.textContent = `${results.filter(result => result.passed).length}/${results.length} passed`;
