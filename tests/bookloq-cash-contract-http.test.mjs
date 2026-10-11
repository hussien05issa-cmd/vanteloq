import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/v1/bookloq/route.ts";
import { businessClock } from "../domain/intraday-sales.ts";
import { createEnvironment, createReportWorkspace, dispatch, identityHeaders, origin } from "./helpers/retail-worker-fixture.mjs";

test("BookLoQ HTTP summary and forecast share obligation review and signed funding facts", { timeout: 120000 }, async () => {
  const { worker, environment, database, dispose } = await createEnvironment();
  const previousEnv = globalThis.__vanteloqEnv;
  try {
    const workspace = await createReportWorkspace(worker, environment, database, "cash-contract-http");
    const org = workspace.organizationId, now = Math.floor(Date.now() / 1000);
    const today = businessClock(new Date(), "America/Edmonton").date;
    const year = today.slice(0, 4);
    await database.prepare("INSERT INTO tenant_addons(id,organization_id,addon_key,status,created_at,updated_at) VALUES(?,?,'bookloq','active',?,?)")
      .bind(crypto.randomUUID(), org, now, now).run();
    const setup = await dispatch(worker, environment, "/api/v1/bookloq/setup", { ...workspace.owner, method: "POST",
      body: { initialize: true, label: "Cash review", startDate: `${year}-01-01`, endDate: `${year}-12-31` } });
    assert.equal(setup.status, 201, await setup.clone().text());
    const cash = await database.prepare("SELECT id FROM financial_accounts WHERE organization_id=? AND system_key='operating_cash'").bind(org).first();
    assert.ok(cash?.id);
    const supplier = crypto.randomUUID(), connection = crypto.randomUUID(), bank = crypto.randomUUID(), order = crypto.randomUUID(), bill = crypto.randomUUID();
    await database.batch([
      database.prepare("INSERT INTO integration_connections(id,organization_id,provider,status,external_account_ref,data_promotion_status,created_at,updated_at) VALUES(?,?,'plaid','connected','fictional-cash-item','approved',?,?)")
        .bind(connection, org, now, now),
      database.prepare("INSERT INTO bank_accounts(id,organization_id,financial_account_id,name,account_type,institution_name,masked_number,currency,provider,external_item_ref,connection_status,live_balance_cents,available_balance_cents,last_sync_at,created_at,updated_at) VALUES(?,?,?,'Fictional bank','chequing','Test','1234','CAD','plaid','fictional-cash-item','healthy',100000,100000,?,?,?)")
        .bind(bank, org, cash.id, now, now, now),
      database.prepare("INSERT INTO bookloq_contacts(id,organization_id,contact_type,name,created_at,updated_at) VALUES(?,?,'supplier','Fictional supplier',?,?)")
        .bind(supplier, org, now, now),
      database.prepare("INSERT INTO purchase_orders(id,organization_id,order_number,supplier_name,order_date,committed_cash_date,currency,status,subtotal_cents,total_cents,created_by_user_id,created_at,updated_at) VALUES(?,?,'PO-CASH-1','Fictional supplier',?,?,'CAD','sent',10000,10000,?,?,?)")
        .bind(order, org, today, today, workspace.userId, now, now),
      database.prepare("INSERT INTO supplier_bills(id,organization_id,supplier_id,bill_number,invoice_date,due_date,status,subtotal_cents,total_cents,paid_cents,currency,purchase_order_ref,approval_status,created_at,updated_at) VALUES(?,?,?,'B-CASH-1',?,?,'approved',20000,20000,0,'USD',?,'approved',?,?)")
        .bind(bill, org, supplier, today, today, order, now, now),
      database.prepare("UPDATE bookloq_settings SET cash_safety_threshold_cents=10000 WHERE organization_id=?").bind(org),
    ]);
    globalThis.__vanteloqEnv = environment;
    const read = async () => {
      const response = await GET(new Request(origin + "/api/v1/bookloq", { headers: identityHeaders(workspace.owner.email, workspace.owner.name) }));
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.ok(body.bookloq, "Expected the BookLoQ response envelope.");
      return body.bookloq;
    };
    const mismatch = await read();
    assert.equal(mismatch.summary.availableCashCents, null);
    assert.equal(mismatch.cashIntelligence.purchasingCapacityCents, null);
    assert.equal(mismatch.thirteenWeekCashFlow.purchasingCapacityCents, null);
    assert.equal(mismatch.thirteenWeekCashFlow.capacityStatus, "obligation_review_required");
    assert.equal(mismatch.thirteenWeekCashFlow.status, "needs_review");
    assert.deepEqual(mismatch.thirteenWeekCashFlow.obligationReviewBlocks, ["linked_bill_currency_mismatch"]);
    assert.equal(mismatch.thirteenWeekCashFlow.openingCashCents, 100000);
    await database.prepare("UPDATE supplier_bills SET currency='CAD' WHERE id=? AND organization_id=?").bind(bill, org).run();
    const reviewed = await read();
    assert.equal(reviewed.summary.availableCashCents, 70000);
    assert.equal(reviewed.cashIntelligence.purchasingCapacityCents, 70000);
    assert.equal(reviewed.thirteenWeekCashFlow.purchasingCapacityCents, 70000);
    assert.equal(reviewed.thirteenWeekCashFlow.reservedPurchasingObligationsCents, 20000);
    await database.prepare("UPDATE bank_accounts SET live_balance_cents=5000,available_balance_cents=5000 WHERE id=? AND organization_id=?").bind(bank, org).run();
    const shortfall = await read();
    assert.equal(shortfall.summary.availableCashCents, 0);
    assert.equal(shortfall.thirteenWeekCashFlow.purchasingCapacityCents, 0);
    assert.equal(shortfall.thirteenWeekCashFlow.unreservedCashCents, -25000);
    assert.equal(shortfall.thirteenWeekCashFlow.fundingShortfallCents, 25000);
  } finally {
    globalThis.__vanteloqEnv = previousEnv;
    await dispose();
  }
});
