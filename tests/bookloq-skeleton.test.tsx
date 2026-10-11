import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import BookLoQSkeleton, { BookLoQCollectionsSkeleton } from "../app/bookloq-skeleton";
import BookLoQWorkspace from "../app/bookloq-workspace";

test("initial BookLoQ loading follows the requested section before permissions arrive", () => {
  const html = renderToStaticMarkup(<BookLoQWorkspace initialSection="Month-End" activeLocationId={null} showNotice={() => {}} createTask={() => {}} navigate={() => {}}/>);
  assert.match(html, /Loading BookLoQ · Month-End/);
  assert.match(html, /bq-loading-close/);
  assert.match(html, /bq-load-checklist/);
  assert.doesNotMatch(html, /bq-loading-collections|Lock selected period|Live ledger|Demonstration data|\d+%/);
});

test("financial section loaders reserve their different chart, record, review and settings layouts", () => {
  const shapes = [
    ["Overview", "collections"], ["Transactions", "review"], ["Banking", "banking"], ["Reconciliation", "reconciliation"],
    ["Sales", "receivables"], ["Invoicing", "receivables"], ["Customers", "records"], ["Expenses", "expenses"], ["Bills", "receivables"], ["Suppliers", "records"],
    ["Inventory Accounting", "inventory"], ["Cash Flow", "cash"], ["Reports", "reports"], ["Budgets", "budgets"], ["Assets and Loans", "profiles"],
    ["Month-End", "close"], ["Chart of Accounts", "records"], ["Journal Entries", "records"], ["Sales Tax", "tax"], ["Payroll", "payroll"],
    ["Accountant Portal", "profiles"], ["Audit Trail", "records"], ["BookLoQ Assistant", "assistant"], ["Settings", "settings"],
  ];
  for (const [section, shape] of shapes) {
    const html = renderToStaticMarkup(<BookLoQSkeleton section={section}/>);
    assert.ok(html.includes(`bq-loading-${shape}`), section);
    assert.equal(html.replace(/<[^>]*>/g, ""), `Loading BookLoQ · ${section}`);
    assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/);
    assert.doesNotMatch(html, /<button|<input|<select|<svg|\$|\d+%/);
  }
});

test("collections loading respects hidden and reordered panels without drawing balances", () => {
  const html = renderToStaticMarkup(<BookLoQCollectionsSkeleton widgets={[{ id: "aging", visible: true }, { id: "schedule", visible: false }, { id: "actions", visible: true }]}/>);
  assert.match(html, /Loading invoice and bill balances/);
  assert.equal((html.match(/bq-load-panel bq-load-metric/g) ?? []).length, 4);
  assert.match(html, /bq-load-aging/);
  assert.match(html, /bq-load-focus/);
  assert.doesNotMatch(html, /bq-load-chart/);
  assert.ok(html.indexOf("bq-load-aging") < html.indexOf("bq-load-focus"));
  assert.match(html, /bq-load-table/);
  assert.equal(html.replace(/<[^>]*>/g, ""), "Loading invoice and bill balances");
});
