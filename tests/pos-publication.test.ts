import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { verifiedPosPublicationSql, withPosPublicationProof } from "../server/integrations/pos-publication.ts";
import { approvedFactSource } from "../server/integrations/trusted-data.ts";

test("publication proof rejects legacy, mixed, deleted and replacement-generation cohorts without crossing tenants", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE integration_connections(id TEXT,organization_id TEXT,provider TEXT,last_sync_cursor TEXT,sync_version INTEGER,status TEXT,data_promotion_status TEXT,source_namespace TEXT,sync_lease_owner TEXT,sync_lease_expires_at INTEGER);
      CREATE TABLE data_imports(id TEXT,organization_id TEXT,status TEXT);
      CREATE TABLE daily_business_metrics(organization_id TEXT,source_connection_id TEXT,source_provider TEXT,source_import_id TEXT,net_sales_cents INTEGER);
      INSERT INTO integration_connections VALUES('one','a','shopify',NULL,7,'connected','approved','live',NULL,NULL);
      INSERT INTO data_imports VALUES('new','a','completed'),('foreign','b','completed');
      INSERT INTO daily_business_metrics VALUES('a','one','shopify','new',10000),('b','one','shopify','foreign',99999);`);
    const cursor = withPosPublicationProof(JSON.stringify({version:2}),"new",1,7);
    const setCursor = (value: string | null) => db.prepare("UPDATE integration_connections SET last_sync_cursor=?").run(value);
    const valid = () => Boolean(db.prepare(`SELECT ${verifiedPosPublicationSql("c")} verified FROM integration_connections c WHERE id='one' AND organization_id='a'`).get()?.verified);
    setCursor(cursor); assert.equal(valid(),true,"Another tenant with the same connection reference cannot affect this cohort");
    for (const legacy of [null,"broken-json",JSON.stringify({version:1}),JSON.stringify({version:2}),withPosPublicationProof(JSON.stringify({version:1}),"new",1,7),withPosPublicationProof(JSON.stringify({version:2}),"foreign",1,7)]) {
      setCursor(legacy); assert.equal(valid(),false);
    }
    setCursor(cursor);
    db.prepare("UPDATE integration_connections SET sync_version=8").run(); assert.equal(valid(),false,"An old worker acquiring a new lease invalidates the earlier publication proof even before writing rows");
    db.prepare("UPDATE integration_connections SET sync_version=7").run(); assert.equal(valid(),true);
    db.prepare("UPDATE daily_business_metrics SET source_import_id='old' WHERE organization_id='a'").run(); assert.equal(valid(),false,"Same row count cannot disguise an older worker's replacement import");
    db.prepare("DELETE FROM daily_business_metrics WHERE organization_id='a'").run(); assert.equal(valid(),false,"Crash after DELETE is not a verified empty snapshot");
    setCursor(withPosPublicationProof(JSON.stringify({version:2}),"new",0,7)); assert.equal(valid(),true);
    const predicate = new SQLiteSyncDialect().sqlToQuery(approvedFactSource(sql.raw("m.organization_id"),sql.raw("m.source_provider"),sql.raw("m.source_connection_id")));
    assert.equal(db.prepare(`SELECT count(*) n FROM daily_business_metrics m WHERE m.organization_id='a' AND ${predicate.sql}`).get(...predicate.params as never[])?.n,0,"A deliberate empty cohort creates no closed-store or zero-sales day");
    db.prepare("INSERT INTO daily_business_metrics VALUES('a',NULL,NULL,NULL,500)").run();
    assert.equal(db.prepare(`SELECT count(*) n FROM daily_business_metrics m WHERE m.organization_id='a' AND ${predicate.sql}`).get(...predicate.params as never[])?.n,1,"Manual facts retain the existing source boundary");
    for (const provider of ["square","plaid","moneris"]) {
      db.prepare("UPDATE integration_connections SET provider=?,last_sync_cursor=NULL").run(provider); assert.equal(valid(),true,"The added contract does not reinterpret unrelated providers");
    }
    assert.throws(() => verifiedPosPublicationSql("c; DROP TABLE x"),/alias/);
  } finally { db.close(); }
});

test("R-Series requires its own current checkpoint and publication generation", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE integration_connections(id TEXT,organization_id TEXT,provider TEXT,last_sync_cursor TEXT,sync_version INTEGER);
      CREATE TABLE data_imports(id TEXT,organization_id TEXT,status TEXT);
      CREATE TABLE daily_business_metrics(organization_id TEXT,source_connection_id TEXT,source_provider TEXT,source_import_id TEXT);
      INSERT INTO integration_connections VALUES('r','a','lightspeed-r',NULL,2);
      INSERT INTO data_imports VALUES('published','a','completed');`);
    const valid = () => Boolean(db.prepare(`SELECT ${verifiedPosPublicationSql("c")} verified FROM integration_connections c`).get()?.verified);
    for (const version of [5,2,6]) {
      db.prepare("UPDATE integration_connections SET last_sync_cursor=?").run(withPosPublicationProof(JSON.stringify({version}),"published",0,2));
      assert.equal(valid(),version===6);
    }
    db.prepare("UPDATE data_imports SET status='processing'").run(); assert.equal(valid(),false);
  } finally { db.close(); }
});
