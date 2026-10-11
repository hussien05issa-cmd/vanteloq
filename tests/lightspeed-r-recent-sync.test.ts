import { verifiedPosPublicationSql } from "../server/integrations/pos-publication.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { posSqliteFixture } from "./helpers/pos-sqlite-fixture.ts";
import { getDb, type VanteloqRuntimeEnv } from "../db/index.ts";
import { users, workspaces, integrationConnections, integrationLocationMappings } from "../db/schema.ts";
import { saveLightspeedRTokens, lightspeedRCheckpointReadyForApproval } from "../server/integrations/lightspeed-r.ts";
import { runSync } from "../server/integrations/sync/lightspeed-r.ts";
import { nextSyncAt } from "../server/integrations/sync-policy.ts";

test("R-Series resumes more than 100 recent receipts independently of historical pages before completing its watermark", async t => {
  const fixture = await posSqliteFixture();
  const {database} = fixture;
  const priorFetch = globalThis.fetch;
  const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: VanteloqRuntimeEnv };
  const priorEnv = runtime.__vanteloqEnv;
  t.after(async () => { globalThis.fetch = priorFetch; runtime.__vanteloqEnv = priorEnv; fixture.close(); });
  runtime.__vanteloqEnv = { DB: database, INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString("base64"), LIGHTSPEED_R_CLIENT_ID: "fictional-client", LIGHTSPEED_R_CLIENT_SECRET: "fictional-secret", LIGHTSPEED_R_REDIRECT_URI: "https://vanteloq.example/api/v1/integrations/lightspeed-r/callback" };
  const db = getDb(), now = new Date(), recentTime = new Date(now.getTime() - 60 * 60_000).toISOString();
  const oldTime = new Date(now.getTime() - 7 * 86400_000).toISOString(), oldWatermark = new Date(now.getTime() - 30 * 86400_000).toISOString();
  const historyUrl = "https://api.lightspeedapp.com/API/V3/Account/123/Sale.json?history=1&page=0&limit=100";
  const initialCheckpoint = { version: 6, catalogVersion: 1, watermark: oldWatermark, salesCursor: historyUrl,
    saleLinesCursor: null, itemsCursor: null, customersCursor: null, suppliersCursor: null,
    salesComplete: false, saleLinesComplete: false, itemsComplete: false, customersComplete: false, suppliersComplete: false };
  await db.insert(users).values({ id: "r-recent-owner", email: "r-recent@example.invalid", displayName: "Fictional Owner", createdAt: now, updatedAt: now });
  const organization = { id: "r-recent-tenant", ownerName: "Fictional Owner", businessName: "Fictional Retailer", legalName: "Fictional Retailer", businessEmail: "r-recent@example.invalid", industry: "Retail", city: "Edmonton", address: "Fictional", postalCode: "T5A 1A1", timezone: "UTC", hoursJson: "[]", createdAt: now, updatedAt: now };
  await db.insert(workspaces).values(organization);
  await db.insert(integrationConnections).values({ id: "r-recent-connection", organizationId: organization.id, provider: "lightspeed-r", sourceNamespace: "production:fictional-recent", status: "connected", externalAccountRef: "123", dataPromotionStatus: "approved", lastSyncCursor: JSON.stringify(initialCheckpoint), createdAt: now, updatedAt: now });
  await db.insert(integrationLocationMappings).values({ id: "r-recent-mapping", organizationId: organization.id, provider: "lightspeed-r", connectionId: "r-recent-connection", externalLocationRef: "1", externalName: "Fictional Shop", status: "mapped", lastSeenAt: now, createdAt: now, updatedAt: now });
  await saveLightspeedRTokens(organization.id, "r-recent-connection", { access_token: "fictional-recent-token", refresh_token: "fictional-refresh-token", expires_in: 3600 });
  const sale = (id: string, soldAt: string) => ({ saleID: id, timeStamp: soldAt, completeTime: soldAt, completed: true, voided: false, shopID: "1", total: "10.50", taxTotal: "0.50", calcFIFOCost: "4.00", calcDiscount: "0",
    SaleLines: { SaleLine: [{ saleID: id, saleLineID: "line-" + id, itemID: "item-1", shopID: "1", timeStamp: soldAt, unitQuantity: "1", unitPrice: "10", calcSubtotal: "10", calcFIFOCost: "4", calcTax1: "0.50" }] },
    SalePayments: { SalePayment: [{ salePaymentID: "payment-" + id, paymentTypeID: "card", amount: "10.50" }] } });
  const recent = Array.from({ length: 101 }, (_, index) => sale(String(index + 1), recentTime));
  const reads: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init), url = new URL(request.url);
    assert.equal(url.origin, "https://api.lightspeedapp.com", "all provider calls stay in the fictional transport");
    assert.equal(request.method, "GET", "the integration only reads this provider");
    reads.push(url.href);
    if (url.pathname.endsWith("/Account.json")) return Response.json({ Account: { accountID: "123", name: "Fictional Retailer" } });
    const resource = url.pathname.split("/").at(-1)!.replace(".json", "");
    if (resource === "Sale") {
      if (url.searchParams.get("history") === "1") {
        const page = Number(url.searchParams.get("page"));
        return Response.json({ Sale: [sale(String(201 + page), oldTime)], "@attributes": page === 0 ? { next: historyUrl.replace("page=0", "page=1") } : {} });
      }
      const threshold = url.searchParams.get("timeStamp")?.slice(2);
      if (threshold && Date.parse(threshold) > Date.parse(recentTime)) return Response.json({ Sale: [], "@attributes": {} });
      const offset = Number(url.searchParams.get("offset") || 0);
      const next = new URL(url); next.searchParams.set("offset", "100");
      return Response.json({ Sale: recent.slice(offset, offset + 100), "@attributes": offset === 0 ? { next: next.href } : {} });
    }
    if (resource === "Item") return Response.json({ Item: [{ itemID: "item-1", description: "Fictional Item", customSku: "FICTIONAL-1", avgCost: "4", ItemShops: { ItemShop: [{ shopID: "1", qoh: "25", reorderPoint: "5" }] } }], "@attributes": {} });
    if (resource === "Customer") return Response.json({ Customer: [{ customerID: "customer-1", firstName: "Fictional" }], "@attributes": {} });
    if (resource === "Vendor") return Response.json({ Vendor: [{ vendorID: "vendor-1", name: "Fictional Vendor" }], "@attributes": {} });
    if (resource === "PaymentType") return Response.json({ PaymentType: [{ paymentTypeID: "card", name: "Visa" }], "@attributes": {} });
    assert.equal(resource, "SaleLine"); return Response.json({ SaleLine: [], "@attributes": {} });
  }) as typeof fetch;
  const [workspace] = await db.select().from(workspaces);
  const context = { userId: "r-recent-owner", organizationId: organization.id, organization: workspace };
  const invoke = () => runSync(new Request("https://vanteloq.example/api/internal/pos-sync", { method: "POST", body: "{}" }), crypto.randomUUID(), context, { connectionId: "r-recent-connection" }, "scheduled").then(response => response.json());
  const first = await invoke();
  const firstCheckpoint = JSON.parse(first.run.cursorPreserved);
  assert.equal(first.backfillComplete, false);
  assert.equal(firstCheckpoint.watermark, oldWatermark);
  assert.match(firstCheckpoint.salesCursor, /history=1&page=1/);
  assert.equal(nextSyncAt(1000, first), 1060);
  const second = await invoke();
  const metric = await database.prepare("SELECT SUM(net_sales_cents) sales, SUM(cost_of_goods_cents) costs, SUM(transaction_count) receipts FROM daily_business_metrics WHERE source_connection_id='r-recent-connection'").first();
  assert.deepEqual(metric, { sales: 103000, costs: 41200, receipts: 103 }, "the 101st recent sale and 2 historical sales must all reach canonical figures");
  assert.match(firstCheckpoint.recentSalesCursor, /offset=100/);
  const secondCheckpoint = JSON.parse(second.run.cursorPreserved);
  assert.equal(second.backfillComplete, true);
  assert.equal(secondCheckpoint.salesCursor, null); assert.equal(secondCheckpoint.recentSalesCursor, null);
  assert.ok(Date.parse(secondCheckpoint.watermark) >= now.getTime());
  assert.equal(lightspeedRCheckpointReadyForApproval(JSON.stringify(secondCheckpoint)), true);
  assert.equal(lightspeedRCheckpointReadyForApproval(JSON.stringify({ ...secondCheckpoint, recentSalesCursor: firstCheckpoint.recentSalesCursor })), false);
  assert.equal(second.dataPromotionEnabled, true);
  assert.equal((await database.prepare(`SELECT ${verifiedPosPublicationSql("c")} verified FROM integration_connections c WHERE id='r-recent-connection'`).first<{verified:number}>())?.verified,1);
  assert.equal(reads.filter(url => url.includes("/Sale.json") && url.includes("offset=100")).length, 1);
  assert.equal((await database.prepare("SELECT COUNT(*) count FROM commerce_sale_lines WHERE organization_id=? AND connection_id='r-recent-connection'").bind(organization.id).first<{count:number}>())?.count, 103);
  assert.equal((await database.prepare("SELECT COUNT(*) count FROM integration_staged_sales WHERE organization_id=? AND connection_id='r-recent-connection'").bind(organization.id).first<{count:number}>())?.count, 103);
  await invoke();
  assert.deepEqual(await database.prepare("SELECT SUM(net_sales_cents) sales, SUM(cost_of_goods_cents) costs, SUM(transaction_count) receipts FROM daily_business_metrics WHERE source_connection_id='r-recent-connection'").first(), metric, "overlapping recent reads must not double-count");
  // A retained historical line count is not quantity evidence. Simulate the
  // additive migration and repair the exact same provider version in place.
  const original = await database.prepare("SELECT id,external_version version,staged_at stamp,line_count lines FROM integration_staged_sales WHERE connection_id='r-recent-connection' AND external_sale_id LIKE '%:1'").first<{id:string;version:string;stamp:number;lines:number}>();
  assert.ok(original);
  await database.prepare("UPDATE integration_staged_sales SET units_milli=NULL WHERE id=?").bind(original.id).run();
  await database.prepare("UPDATE integration_connections SET last_sync_cursor=?,data_promotion_status='staging',promotion_authorized_at=1 WHERE id='r-recent-connection'").bind(JSON.stringify({version:5})).run();
  const repair = await invoke();
  assert.equal(repair.run.cursorPreserved && JSON.parse(repair.run.cursorPreserved).version,6);
  assert.deepEqual(await database.prepare("SELECT id,external_version version,staged_at stamp,line_count lines FROM integration_staged_sales WHERE id=?").bind(original.id).first(),original);
  assert.equal((await database.prepare("SELECT units_milli quantity FROM integration_staged_sales WHERE id=?").bind(original.id).first<{quantity:number}>())?.quantity,1000);
  assert.equal((await database.prepare("SELECT COUNT(*) count FROM integration_staged_sales WHERE connection_id='r-recent-connection'").first<{count:number}>())?.count,103);
  await invoke(); // Finish the resumed recent pages before testing missing evidence.

  const originalQuantity = recent[0].SaleLines.SaleLine[0].unitQuantity;
  Reflect.deleteProperty(recent[0].SaleLines.SaleLine[0],"unitQuantity");
  const beforeMissing = await database.prepare("SELECT SUM(net_sales_cents) sales, SUM(units_sold) units FROM daily_business_metrics WHERE source_connection_id='r-recent-connection'").first();
  const missing = await invoke();
  assert.equal(missing.dataPromotionEnabled,false); assert.match(missing.nextStep,/quantity history/i);
  assert.equal((await database.prepare("SELECT units_milli quantity FROM integration_staged_sales WHERE id=?").bind(original.id).first<{quantity:number|null}>())?.quantity,null);
  const missingFinished = await invoke();
  assert.equal(JSON.parse(missingFinished.run.cursorPreserved).watermark,null,"Unknown historical quantities must remain eligible for a source reread");
  assert.deepEqual(await database.prepare("SELECT SUM(net_sales_cents) sales, SUM(units_sold) units FROM daily_business_metrics WHERE source_connection_id='r-recent-connection'").first(),beforeMissing,"Incomplete evidence cannot replace retained canonical metrics");
  assert.equal((await database.prepare("SELECT last_error_code error FROM integration_connections WHERE id='r-recent-connection'").first<{error:string}>())?.error,"LIGHTSPEED_R_QUANTITY_REVIEW_REQUIRED");
  recent[0].SaleLines.SaleLine[0].unitQuantity=originalQuantity;
  const recovered = await invoke();
  assert.equal((await database.prepare(`SELECT ${verifiedPosPublicationSql("c")} verified FROM integration_connections c WHERE id='r-recent-connection'`).first<{verified:number}>())?.verified,1);
  assert.equal(recovered.dataPromotionEnabled,true,"Preserved authorization permits recovery after the same-version source reread");
  assert.equal((await database.prepare("SELECT COUNT(*) count FROM integration_staged_sales WHERE connection_id='r-recent-connection'").first<{count:number}>())?.count,103);
  assert.deepEqual(await database.prepare("SELECT SUM(net_sales_cents) sales, SUM(units_sold) units FROM daily_business_metrics WHERE source_connection_id='r-recent-connection'").first(),beforeMissing);
  const callsBeforeForeign = reads.length;
  await assert.rejects(runSync(new Request("https://vanteloq.example"), crypto.randomUUID(), { ...context, organizationId: "other-tenant" }, { connectionId: "r-recent-connection" }, "scheduled"), { status: 404 });
  assert.equal(reads.length, callsBeforeForeign);
});
