import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import WorkspaceShowcase, { showcaseBills, showcaseCashSchedule, showcaseDate, showcaseInvoices, showcaseSummary } from "../app/workspace-showcase";

test("showcase balances reconcile to partial payments and exclude paid records", () => {
  assert.deepEqual(showcaseSummary, { receivables: 2480000, overdue: 640000, payables: 1420000, payablesDue: 960000 });
  assert.equal(showcaseInvoices.filter(row => row.total > row.paid).length, 6);
  assert.equal(showcaseBills.filter(row => row.total > row.paid).length, 4);
  assert.equal(showcaseInvoices.filter(row => row.total > row.paid && row.due < showcaseDate).length, 3);
  for (const rows of [showcaseInvoices, showcaseBills]) {
    assert.ok(rows.some(row => row.total === row.paid));
    assert.ok(rows.some(row => row.paid > 0 && row.total > row.paid));
    assert.ok(rows.every(row => Number.isSafeInteger(row.total) && Number.isSafeInteger(row.paid) && row.total >= row.paid));
  }
});

test("cash scenarios use the same future balances without treating overdue invoices as cash", () => {
  const onTime = showcaseCashSchedule(), delayed = showcaseCashSchedule(true);
  for (const schedule of [onTime, delayed]) {
    let previousClosing = 1800000;
    for (const week of schedule) {
      assert.equal(week.opening, previousClosing);
      assert.equal(week.closing, week.opening + week.receipts - week.payments);
      assert.ok(week.invoices.every(row => row.due >= showcaseDate));
      previousClosing = week.closing;
    }
    assert.equal(schedule.reduce((sum, week) => sum + week.payments, 0), showcaseSummary.payablesDue);
  }
  assert.equal(onTime.reduce((sum, week) => sum + week.receipts, 0), showcaseSummary.receivables - showcaseSummary.overdue);
  assert.equal(onTime.at(-1)?.closing, 2680000);
  assert.equal(delayed.at(-1)?.closing, 2496000);
  assert.equal(onTime.at(-1)!.closing - delayed.at(-1)!.closing, 184000);
});

test("homepage preview exposes real navigation controls and clearly labels its figures", () => {
  const html = renderToStaticMarkup(<WorkspaceShowcase/>);
  const navigation = html.match(/<nav aria-label="BookLoQ preview sections">([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(navigation);
  for (const label of ["Overview", "Invoices", "Bills", "Cash Flow", "Reports"]) {
    assert.ok(navigation.includes(`<span>${label}</span>`));
  }
  assert.equal((navigation.match(/<button /g) || []).length, 5);
  assert.equal((navigation.match(/aria-controls=/g) || []).length, 5);
  assert.match(html, /Fictional demonstration/);
  assert.match(html, /As of Sep 27, 2026/);
  assert.match(html, /No records are saved/);
});
