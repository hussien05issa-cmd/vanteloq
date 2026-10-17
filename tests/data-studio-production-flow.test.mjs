import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { createEnvironment, createReportWorkspace, dispatch, seedReportMetric, seedReportConnection } from "./helpers/retail-worker-fixture.mjs";

test("production-built Studio route exports the full authorized scope and excludes unapproved provider records", async () => {
  const f = await createEnvironment();
  try {
    const a = await createReportWorkspace(f.worker, f.environment, f.database, "studio-a");
    const b = await createReportWorkspace(f.worker, f.environment, f.database, "studio-b");
    await seedReportMetric(f.database, { ...a, businessDate: "2026-10-01", locationRef: a.locationId, netSalesCents: 12345 });
    await seedReportMetric(f.database, { ...b, businessDate: "2026-10-01", locationRef: b.locationId, netSalesCents: 999999 });
    const scope = "/api/v1/data-studio/executive?from=2026-10-01&to=2026-10-02";
    const preview = await dispatch(f.worker, f.environment, scope, a.owner);
    assert.equal(preview.status, 200, await preview.clone().text());
    const review = await preview.json(); assert.equal(review.sales.summary.netSalesCents, 12345);
    assert.equal(review.metadata.rowCount, 1); assert.doesNotMatch(JSON.stringify(review), new RegExp(b.organizationId));
    const response = await dispatch(f.worker, f.environment, scope + "&format=xlsx&snapshot=" + review.metadata.snapshotHash, a.owner);
    assert.equal(response.status, 200, response.status === 200 ? "" : await response.text());
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await response.arrayBuffer());
    assert.equal(workbook.worksheets.length, 7); assert.equal(workbook.getWorksheet("Sales").getCell("E2").value, 123.45);
    assert.match(response.headers.get("cache-control"), /no-store/);
    const connectionId = crypto.randomUUID();
    await seedReportConnection(f.database, { organizationId: a.organizationId, locationId: a.locationId, connectionId, namespace: "test-staging", externalLocationRef: "same-shop", promotionStatus: "staging" });
    const denied = await dispatch(f.worker, f.environment, scope + "&connection=" + connectionId, a.owner);
    assert.equal(denied.status, 403, await denied.clone().text());
  } finally { await f.dispose(); }
});
