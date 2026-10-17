import assert from "node:assert/strict";
import test from "node:test";
import { transactionMatchesQuery, periodCloseState } from "../domain/bookloq-workflow.ts";
import { loadReceiptEvidence } from "../app/bookloq-receipt-evidence.ts";

const transaction = { description: "Coffee", originalDescription: "CAFÉ SALE", contactName: null, accountName: "Revenue", sourceSystem: "bank_statement", externalSourceId: "EXT-Order-901" };
test("finance search finds provider labels and external references independently of descriptions", () => {
  assert.equal(transactionMatchesQuery(transaction, " BANK_STATEMENT "), true);
  assert.equal(transactionMatchesQuery(transaction, "bank statement"), true);
  assert.equal(transactionMatchesQuery(transaction, "ext-order-901"), true);
  assert.equal(transactionMatchesQuery(transaction, "café"), true);
  assert.equal(transactionMatchesQuery(transaction, "revenue"), true);
  assert.equal(transactionMatchesQuery(transaction, "missing-source"), false);
  assert.equal(transactionMatchesQuery(transaction, "  "), true);
});

const controls = [{ periodId: "oct", status: "complete" }, { periodId: "sep", status: "blocked" }];
test("close progress and lock readiness use only the selected period", () => {
  const october = periodCloseState({ id: "oct", status: "open" }, controls);
  assert.equal(october.items.length, 1);
  assert.equal(october.progress, 1);
  assert.equal(october.readyToLock, true);
  const september = periodCloseState({ id: "sep", status: "review" }, controls);
  assert.equal(september.progress, 0);
  assert.equal(september.readyToLock, false);
});
test("an empty, missing or locked period cannot be declared ready", () => {
  assert.equal(periodCloseState({ id: "nov", status: "open" }, controls).readyToLock, false);
  assert.equal(periodCloseState(null, controls).progress, 0);
  const locked = periodCloseState({ id: "oct", status: "locked" }, controls);
  assert.equal(locked.editable, false);
  assert.equal(locked.readyToLock, false);
  assert.equal(locked.complete, 1);
});
test("receipt evidence uses the authenticated original endpoint with the cancellation signal", async () => {
  const signal = new AbortController().signal;
  const blob = await loadReceiptEvidence(async (path, options) => {
    assert.equal(path, "/api/v1/documents?id=receipt%2F1");
    assert.equal(options?.signal, signal);
    assert.equal(options?.method, undefined);
    return new Response("%PDF-1.7 test", { headers: { "Content-Type": "application/pdf" } });
  }, "receipt/1", signal);
  assert.equal(blob.type, "application/pdf");
  assert.ok(blob.size > 0);
});
test("denied, quarantined, empty and unsupported receipts cannot become preview evidence", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(loadReceiptEvidence(async () => Response.json({ error: { message: "Download permission required" } }, { status: 403 }), "receipt", signal), /Download permission required/);
  await assert.rejects(loadReceiptEvidence(async () => Response.json({ error: { message: "Receipt remains quarantined" } }, { status: 423 }), "receipt", signal), /quarantined/);
  await assert.rejects(loadReceiptEvidence(async () => new Response("<html>wrong</html>", { headers: { "Content-Type": "text/html" } }), "receipt", signal), /cannot be previewed/);
  await assert.rejects(loadReceiptEvidence(async () => new Response("", { headers: { "Content-Type": "image/png" } }), "receipt", signal), /empty/);
});
test("cancelled receipt review does not return a late original", async () => {
  const controller = new AbortController();
  await assert.rejects(loadReceiptEvidence(async () => { controller.abort(); return new Response("receipt", { headers: { "Content-Type": "image/png" } }); }, "receipt", controller.signal), { name: "AbortError" });
});
