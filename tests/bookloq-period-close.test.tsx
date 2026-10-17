import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BookLoQPeriodClose from "../app/bookloq-period-close";
import BookLoQReceiptReview from "../app/bookloq-receipt-review";
import type { BookLoQData } from "../app/bookloq-workspace";

function fixture(locked = false, owner = true) {
  return {
    role: owner ? "owner" : "admin",
    permissions: ["reconcile_accounts", "lock_periods", ...(owner ? ["unlock_periods"] : [])],
    organization: { currency: "CAD" }, accountCatalog: [{ id: "cash" }], statements: { accounts: [] },
    periods: [
      { id: "oct", label: "October 2026", startDate: "2026-10-01", endDate: "2026-10-31", status: locked ? "locked" : "open" },
      { id: "sep", label: "September 2026", startDate: "2026-09-01", endDate: "2026-09-30", status: "open" },
    ],
    closeItems: [
      { id: "oct-bank", periodId: "oct", title: "October bank review", status: "complete", dueDate: null, blocker: "" },
      { id: "sep-bank", periodId: "sep", title: "September bank review", status: "blocked", dueDate: null, blocker: "Missing statement" },
    ],
  // Only fields read by the period and setup components are needed in this rendering fixture.
  } as unknown as BookLoQData;
}
const render = (data: BookLoQData) => renderToStaticMarkup(<BookLoQPeriodClose data={data} refresh={async () => {}} showNotice={() => {}}/>);

test("period close displays only the selected period's controls and completion", () => {
  const html = render(fixture());
  assert.match(html, /1 of 1 controls complete for October 2026/);
  assert.match(html, /October bank review/);
  assert.doesNotMatch(html, /September bank review|Missing statement/);
  assert.match(html, /<button type="button" title="Lock October 2026">Lock selected period/);
});
test("locked checklist is read-only and reopening needs an entered reason", () => {
  const html = render(fixture(true));
  assert.match(html, /aria-label="Status for October bank review" disabled=""/);
  assert.match(html, /Reason for reopening<textarea required="" maxLength="1000"/);
  assert.match(html, /disabled="">Reopen selected period for review/);
});
test("accounts without unlock permission do not receive a reopening form", () => {
  const html = render(fixture(true, false));
  assert.match(html, /Ask a workspace owner with period-unlock permission/);
  assert.doesNotMatch(html, /Reason for reopening<textarea|Reopen selected period for review/);
});
test("receipt review cannot offer confirmation before authenticated evidence loads", () => {
  const html = renderToStaticMarkup(<BookLoQReceiptReview receipt={{ id: "receipt", fileName: "receipt.pdf" }} transactionLabel="Office supplies ($24.00)" busy={false} canMatch={true} close={() => {}} confirm={async () => { throw new Error("Rendering must not match evidence"); }}/>);
  assert.match(html, /Opening the verified original receipt/);
  assert.match(html, /does not save a match or post an expense/);
  assert.doesNotMatch(html, /Confirm receipt match|<input/);
});
test("imported bank accounts without an active accounting profile still offer chart initialization", () => {
  const data = fixture();
  data.permissions.push("post_journals");
  data.settings = null;
  assert.match(render(data), /Set up your books/);
  assert.doesNotMatch(render(data), /Add a period/);
});
test("an active chart is recognized before its first posted journal", () => {
  const data = fixture();
  data.permissions.push("post_journals");
  data.settings = { status: "active", baseCurrency: "CAD", countryCode: "CA", provinceCode: "AB", accountingBasis: "accrual", cashSafetyThresholdCents: 0, dataMode: "live" };
  assert.equal(data.statements.accounts.length, 0);
  assert.match(render(data), /Add a period/);
  assert.doesNotMatch(render(data), /Set up your books/);
});
test("new period setup is not offered without period-management permission", () => {
  const data = fixture();
  data.permissions = ["post_journals", "reconcile_accounts"];
  const html = render(data);
  assert.doesNotMatch(html, /Accounting setup and new period|Set up your books|Lock selected period/);
});
