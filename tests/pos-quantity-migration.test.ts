import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

test("quantity migration preserves unknown historical evidence and requires affected sources to be reviewed", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE integration_staged_sales(id TEXT PRIMARY KEY,line_count INTEGER);
      CREATE TABLE integration_connections(id TEXT PRIMARY KEY,provider TEXT,data_promotion_status TEXT,promotion_authorized_at INTEGER,last_error_code TEXT);
      INSERT INTO integration_staged_sales VALUES('retained',7);
      INSERT INTO integration_connections VALUES('shop','shopify','approved',123,NULL),('pos','shopify-pos','approved',123,NULL),('r','lightspeed-r','approved',123,NULL),('square','square','approved',123,NULL),('draft','shopify','staging',NULL,'existing');`);
    const migrationDir = resolve(process.env.POS_PATCH_SOURCE_REPO ?? process.cwd(), "drizzle");
    const migrations = readdirSync(migrationDir).filter(name => /^\d{4}.*\.sql$/.test(name)).map(name => readFileSync(resolve(migrationDir,name),"utf8"));
    // Before integration the proposal keeps this candidate outside the checkout.
    if (!migrations.some(sql => /ADD(?: COLUMN)? [`"]?units_milli/i.test(sql))) migrations.push(readFileSync(new URL("../drizzle/0075_pos_quantity_evidence.sql",import.meta.url),"utf8"));
    const relevant = migrations.flatMap(sql => sql.split("--> statement-breakpoint")).filter(sql => /ALTER TABLE [`"]?integration_staged_sales[`"]? ADD(?: COLUMN)? [`"]?units_milli|POS_FINANCIAL_HISTORY_REVIEW_REQUIRED/i.test(sql));
    assert.equal(relevant.length,2,"The generated migration must include both nullable quantity evidence and the staging downgrade");
    for (const statement of relevant) db.exec(statement);
    const row = db.prepare("SELECT line_count lines,units_milli units FROM integration_staged_sales WHERE id='retained'").get();
    assert.equal(row?.lines,7); assert.equal(row?.units,null);
    for (const id of ["shop","pos","r"]) {
      const source = db.prepare("SELECT data_promotion_status status,promotion_authorized_at approval,last_error_code error FROM integration_connections WHERE id=?").get(id);
      assert.equal(source?.status,"staging"); assert.equal(source?.approval,null); assert.equal(source?.error,"POS_FINANCIAL_HISTORY_REVIEW_REQUIRED");
    }
    assert.equal(db.prepare("SELECT data_promotion_status status FROM integration_connections WHERE id='square'").get()?.status,"approved");
    assert.equal(db.prepare("SELECT last_error_code error FROM integration_connections WHERE id='draft'").get()?.error,"existing");
    db.prepare("UPDATE integration_staged_sales SET units_milli=0").run();
    assert.equal(db.prepare("SELECT units_milli units FROM integration_staged_sales").get()?.units,0);
  } finally { db.close(); }
});
