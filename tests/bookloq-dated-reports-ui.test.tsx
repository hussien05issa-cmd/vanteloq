import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DatedReportResults, ReportsPanel, type BookLoQData } from "../app/bookloq-workspace";
import { ledgerIntelligence } from "../domain/executive-metrics";
import type { BookloqDatedReport } from "../server/bookloq-reports";

const base = { organization: { id: "org", name: "QA", currency: "CAD" }, settings: { status: "active", baseCurrency: "CAD", accountingBasis: "accrual", dataMode: "live" }, locationScope: null, permissions: [], ledgerAccess: { available: true } } as unknown as BookLoQData;
const renderPanel = (data = base) => renderToStaticMarkup(<ReportsPanel data={data} navigate={() => {}} canUploadDocuments={false} canViewDocuments={false} openStatementImport={() => {}}/>);
function report(detailAvailable = true) {
  const accounts = [{ id: "sales", code: "4000", name: "Recorded sales", accountType: "revenue", accountSubtype: "sales", systemKey: null, normalBalance: "credit", active: 0, debitCents: 0, creditCents: 12345, closingDebitCents: 0, closingCreditCents: 12345, periodBalanceCents: 12345, closingBalanceCents: 12345, lineCount: 1, closingLineCount: 1 }];
  return { metadata: { currency: "CAD", detailAvailable }, accounts, profitAndLoss: ledgerIntelligence(accounts), balanceSheet: { assetCents: 12345, liabilityCents: 0, equityCents: 12345, recordedEarningsCents: 12345, differenceCents: 0 }, trialBalance: { debitCents: 12345, creditCents: 12345, differenceCents: 0 }, coverage: { periodLineCount: 1, closingLineCount: 2 }, detail: null } as BookloqDatedReport;
}

test("date controls show explicit period labels and a loading read instead of old cumulative balances", () => {
  const html = renderPanel();
  assert.match(html, /Period start/); assert.match(html, /Period end/); assert.match(html, /Apply dates/);
  assert.match(html, /Reading posted ledger entries/);
  assert.doesNotMatch(html, /Cumulative posted account balances|Export report CSV/);
});
test("unsupported cash profiles and selected locations show a clear gate without report inputs", () => {
  const cash = renderPanel({ ...base, settings: { ...base.settings!, accountingBasis: "cash" } });
  assert.match(cash, /Cash-basis conversion is not implemented/); assert.doesNotMatch(cash, /type="date"/);
  const location = renderPanel({ ...base, locationScope: { id: "branch" } as BookLoQData["locationScope"] });
  assert.match(location, /Select All locations/); assert.doesNotMatch(location, /type="date"/);
});
test("aggregate-only permission retains financial summaries but disables account detail actions", () => {
  const html = renderToStaticMarkup(<DatedReportResults data={report(false)} report="pnl" selectAccount={() => {}}/>);
  assert.match(html, /Recorded net earnings/); assert.match(html, /123\.45/);
  assert.match(html, /individual payroll and banking transaction permissions/);
  assert.match(html, /disabled="">Recorded sales \(archived\)/);
});
test("balance statements explain derived retained earnings and unbalanced or empty records", () => {
  const data = report(); data.coverage.closingLineCount = 0; data.balanceSheet.differenceCents = 1;
  const html = renderToStaticMarkup(<DatedReportResults data={data} report="balance" selectAccount={() => {}}/>);
  assert.match(html, /Recorded earnings through the as-of date/);
  assert.match(html, /Zero recorded balances do not establish complete books/);
  assert.match(html, /Ledger difference requires review/);
});
