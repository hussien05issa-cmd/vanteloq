import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyOwnerInventoryCosts, prepareOwnerCostChange, ownerCostInstant } from "../server/inventory-costs";

// SQLite executes the same SQL used by the D1 binding, with the production
// lookup indexes. All records below are disposable and fictional.
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE workspaces (id TEXT, timezone TEXT);
    INSERT INTO workspaces VALUES ('qa', 'America/Edmonton');
    CREATE TABLE commerce_products (organization_id TEXT, provider TEXT, connection_id TEXT,
      external_product_id TEXT, sku TEXT, archived INTEGER DEFAULT 0,
      owner_cost_cents INTEGER, default_cost_cents INTEGER);
    CREATE UNIQUE INDEX commerce_products_external_unique ON commerce_products(organization_id,provider,connection_id,external_product_id);
    CREATE INDEX commerce_products_sku_idx ON commerce_products(organization_id,sku);
    ALTER TABLE commerce_products ADD COLUMN id TEXT;
    ALTER TABLE commerce_products ADD COLUMN owner_cost_updated_at INTEGER DEFAULT 0;
    ALTER TABLE commerce_products ADD COLUMN owner_cost_source TEXT;
    ALTER TABLE commerce_products ADD COLUMN owner_cost_updated_by_user_id TEXT;
    CREATE TABLE commerce_sale_lines (id TEXT, organization_id TEXT, provider TEXT, connection_id TEXT,
      external_sale_id TEXT, external_line_id TEXT, product_ref TEXT, sku TEXT, quantity_milli INTEGER,
      net_sales_cents INTEGER, cost_cents INTEGER, updated_at INTEGER, sold_at TEXT, outlet_ref TEXT);
    CREATE UNIQUE INDEX commerce_sale_lines_external_unique ON commerce_sale_lines(organization_id,provider,connection_id,external_sale_id,external_line_id);
    CREATE UNIQUE INDEX commerce_sale_lines_id_unique ON commerce_sale_lines(id);
    CREATE INDEX commerce_sale_lines_product_date_idx ON commerce_sale_lines(organization_id,provider,product_ref,sold_at);
    CREATE INDEX commerce_sale_lines_source_date_idx ON commerce_sale_lines(organization_id,provider,connection_id,sold_at);
    ALTER TABLE commerce_sale_lines ADD COLUMN cost_known INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE integration_staged_sales (organization_id TEXT, provider TEXT, connection_id TEXT, external_sale_id TEXT, cost_cents INTEGER);
    CREATE TABLE daily_business_metrics (organization_id TEXT, source_connection_id TEXT, business_date TEXT,
      location_ref TEXT, cost_of_goods_cents INTEGER, updated_at INTEGER);
    ALTER TABLE integration_staged_sales ADD COLUMN id TEXT;
    ALTER TABLE integration_staged_sales ADD COLUMN sold_at TEXT;
    ALTER TABLE integration_staged_sales ADD COLUMN state TEXT DEFAULT 'completed';
    ALTER TABLE integration_staged_sales ADD COLUMN staged_at INTEGER DEFAULT 0;
    ALTER TABLE integration_staged_sales ADD COLUMN external_version TEXT DEFAULT '1';
    CREATE UNIQUE INDEX integration_staged_sales_version_unique ON integration_staged_sales(organization_id,provider,connection_id,external_sale_id,external_version);
    CREATE TABLE audit_events (id TEXT PRIMARY KEY,organization_id TEXT,actor_user_id TEXT,action TEXT,
      resource_type TEXT,resource_id TEXT,outcome TEXT CHECK(outcome IN ('success','failure')),request_id TEXT,source_hash TEXT,
      details_json TEXT,created_at INTEGER);
    CREATE INDEX audit_events_workspace_created_idx ON audit_events(organization_id,created_at);
    CREATE TABLE integration_connections (id TEXT, organization_id TEXT,status TEXT,data_promotion_status TEXT);
  `);
  const originalExec = sqlite.exec.bind(sqlite);
  sqlite.exec = (sql: string) => originalExec(sql
    .replaceAll("INSERT INTO commerce_products VALUES", "INSERT INTO commerce_products (organization_id,provider,connection_id,external_product_id,sku,archived,owner_cost_cents,default_cost_cents) VALUES")
    .replaceAll("INSERT INTO commerce_sale_lines VALUES", "INSERT INTO commerce_sale_lines (id,organization_id,provider,connection_id,external_sale_id,external_line_id,product_ref,sku,quantity_milli,net_sales_cents,cost_cents,updated_at,sold_at,outlet_ref) VALUES")
    .replaceAll("INSERT INTO integration_staged_sales VALUES", "INSERT INTO integration_staged_sales (organization_id,provider,connection_id,external_sale_id,cost_cents) VALUES"));
  const statements: string[] = [];
  const executions: Array<{sql:string;args:Array<string|number|null>}> = [];
  function prepare(sql: string) {
    const statement = sqlite.prepare(sql);
    let args: Array<string | number | null> = [];
    return {
      bind(...values: Array<string | number | null>) { args = values; return this; },
      async run() { statements.push(sql); executions.push({sql,args}); return statement.run(...args); },
      async first() { statements.push(sql); executions.push({sql,args}); return statement.get(...args) ?? null; },
      async all() { statements.push(sql); executions.push({sql,args}); return { results: statement.all(...args) }; },
    };
  }
  const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: unknown };
  const previous = runtime.__vanteloqEnv;
  runtime.__vanteloqEnv = { DB: { prepare, batch: async (items: ReturnType<typeof prepare>[]) => {
    sqlite.exec('BEGIN'); try { const results=[]; for (const item of items) results.push(await item.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } } };
  return { sqlite, statements, executions, database: (runtime.__vanteloqEnv as {DB:D1Database}).DB, close() { runtime.__vanteloqEnv = previous; sqlite.close(); } };
}

test("owner costs preserve signed quantities, tenant boundaries and business-date daily totals", async () => {
  const f = fixture();
  try {
    f.sqlite.exec(`
      INSERT INTO commerce_products VALUES ('qa','pos','one','p1','SKU1',0,321,100), ('qa','pos','one','p2','SKU2',0,200,NULL),
        ('other','pos','one','p1','SKU1',0,9999,NULL), ('qa','pos','two','p1','SKU1',0,8888,NULL);
      INSERT INTO commerce_sale_lines VALUES
        ('sale','qa','pos','one','s1','1','p1','SKU1',1500,1000,100,1,'2026-09-14T18:00:00Z','shop'),
        ('refund','qa','pos','one','s1','2','p1','SKU1',-1000,-700,-100,1,'2026-09-14T18:00:00Z','shop'),
        ('sku','qa','pos','one','s1','3',NULL,'SKU2',1000,800,0,1,'2026-09-14T18:00:00Z','shop'),
        ('unknown','qa','pos','one','s2','1','missing','SKU2',1000,800,0,1,'2026-09-15T07:00:00Z','shop'),
        ('other','other','pos','one','s1','1','p1','SKU1',1000,800,17,1,'2026-09-14T18:00:00Z','shop'),
        ('connection','qa','pos','two','s1','1','p1','SKU1',1000,800,19,1,'2026-09-14T18:00:00Z','shop');
      INSERT INTO integration_staged_sales VALUES ('qa','pos','one','s1',0), ('other','pos','one','s1',17);
      INSERT INTO daily_business_metrics VALUES ('qa','one','2026-09-14','pos:shop',0,1), ('other','one','2026-09-14','pos:shop',17,1);
    `);
    const result = await applyOwnerInventoryCosts('qa', 'one', 42);
    const costs = Object.fromEntries(f.sqlite.prepare('SELECT id,cost_cents cost FROM commerce_sale_lines').all().map(r => [r.id,r.cost]));
    assert.deepEqual(costs, { sale:482, refund:-321, sku:200, unknown:0, other:17, connection:19 });
    assert.equal(result.missingCostLines, 1, "a mismatched product reference must not fall back to SKU");
    assert.equal(f.sqlite.prepare("SELECT cost_cents cost FROM integration_staged_sales WHERE organization_id='qa'").get()!.cost, 361);
    assert.equal(f.sqlite.prepare("SELECT cost_of_goods_cents cost FROM daily_business_metrics WHERE organization_id='qa'").get()!.cost, 361);
    assert.equal(f.sqlite.prepare("SELECT updated_at stamp FROM daily_business_metrics WHERE organization_id='other'").get()!.stamp, 1);
  } finally { f.close(); }
});

test("staging-only cost refresh never publishes daily metrics", async () => {
  const f = fixture();
  try {
    f.sqlite.exec(`INSERT INTO commerce_products VALUES ('qa','pos','one','p1','SKU1',0,300,NULL);
      INSERT INTO commerce_sale_lines VALUES ('x','qa','pos','one','s1','1','p1','SKU1',1000,800,0,1,'2026-09-14T18:00:00Z','shop');
      INSERT INTO daily_business_metrics VALUES ('qa','one','2026-09-14','pos:shop',123,1);`);
    await applyOwnerInventoryCosts('qa','one',42,{publishDailyMetrics:false});
    assert.equal(f.sqlite.prepare('SELECT cost_cents cost FROM commerce_sale_lines').get()!.cost,300);
    assert.equal(f.sqlite.prepare('SELECT cost_of_goods_cents cost FROM daily_business_metrics').get()!.cost,123);
  } finally { f.close(); }
});

test("no owner overrides avoids ledger rewrites and counts missing costs once per line", async t => {
  const f = fixture();
  try {
    f.sqlite.exec('BEGIN');
    const product = f.sqlite.prepare('INSERT INTO commerce_products (organization_id,provider,connection_id,external_product_id,sku,archived,owner_cost_cents,default_cost_cents) VALUES (?,?,?,?,?,0,NULL,NULL)');
    const line = f.sqlite.prepare("INSERT INTO commerce_sale_lines (id,organization_id,provider,connection_id,external_sale_id,external_line_id,product_ref,sku,quantity_milli,net_sales_cents,cost_cents,updated_at,sold_at,outlet_ref) VALUES (?,'qa','pos','one',?,'1',?,?,1000,100,0,1,'2026-09-14T18:00:00Z','shop')");
    for (let i=0;i<2000;i++) product.run('qa','pos','one',`p${i}`,`SKU${i}`);
    for (let i=0;i<20000;i++) line.run(`l${i}`,`s${i}`,`p${i%2000}`,`SKU${i%2000}`);
    // An explicit zero is known, and a cost on another tenant is irrelevant.
    f.sqlite.exec("UPDATE commerce_products SET default_cost_cents=0 WHERE external_product_id='p0'; UPDATE commerce_sale_lines SET cost_known=1 WHERE product_ref='p0'; INSERT INTO commerce_products VALUES ('other','pos','one','p1','SKU1',0,900,NULL); COMMIT;");
    const before = performance.now();
    const result = await applyOwnerInventoryCosts('qa','one',42);
    t.diagnostic(`20,000 sale lines / 2,000 products checked in ${Math.round(performance.now()-before)}ms (local SQLite)`);
    assert.equal(result.missingCostLines,19990);
    assert.equal(f.statements.filter(sql => /UPDATE|INSERT|DELETE/.test(sql)).length,0);
    const query = f.statements.find(sql => sql.includes('COUNT(*) AS count'))!;
    const plan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`).all('qa','one').map(r => String(r.detail)).join('\n');
    assert.match(plan,/commerce_sale_lines_source_date_idx/);
  } finally { f.close(); }
});

test("effective costs preserve earlier sales, signed returns, refreshes and tenant boundaries", async () => {
  const f = fixture();
  try {
    const cutoff=Date.parse('2026-09-15T18:00:00Z');
    f.sqlite.exec(`INSERT INTO integration_connections VALUES ('one','qa','connected','approved');
      INSERT INTO commerce_products VALUES ('qa','pos','one','p1','SKU1',0,300,NULL),('other','pos','one','p1','SKU1',0,999,NULL);
      UPDATE commerce_products SET id=organization_id||'-product',owner_cost_updated_at=${Date.parse('2026-09-01T00:00:00Z')} ;
      INSERT INTO commerce_sale_lines VALUES
        ('before','qa','pos','one','s1','1','p1','SKU1',1000,900,300,1,'2026-09-15T17:59:59.999Z','shop'),
        ('after','qa','pos','one','s2','1','p1','SKU1',1000,900,0,1,'2026-09-15T18:00:00Z','shop'),
        ('local','qa','pos','one','s3','1','p1','SKU1',1500,1200,0,1,'2026-09-15T12:00:00','shop'),
        ('return','qa','pos','one','s1','2','p1','SKU1',-1000,-900,-300,1,'2026-09-15T17:59:59.999Z','shop'),
        ('other','other','pos','one','s2','1','p1','SKU1',1000,900,999,1,'2026-09-15T18:00:00Z','shop');`);
    await f.database.batch(await prepareOwnerCostChange(f.database,{request:new Request('https://vanteloq.example/api/v1/inventory-costs'),requestId:'fictional',organizationId:'qa',userId:'owner',productId:'qa-product',source:'manual',unitCostCents:600,now:cutoff}));
    await applyOwnerInventoryCosts('qa','one',cutoff,{publishDailyMetrics:false});
    const read=()=>Object.fromEntries(f.sqlite.prepare('SELECT id,cost_cents cost FROM commerce_sale_lines').all().map(row=>[row.id,row.cost]));
    assert.deepEqual(read(),{before:300,after:600,local:900,return:-300,other:999});
    // A repeated provider fetch presents newer catalog costs; the schedule restores the original sale basis.
    f.sqlite.exec("UPDATE commerce_products SET default_cost_cents=800; UPDATE commerce_sale_lines SET cost_cents=800 WHERE organization_id='qa' AND quantity_milli>0");
    await applyOwnerInventoryCosts('qa','one',cutoff+1,{publishDailyMetrics:false});
    assert.deepEqual(read(),{before:300,after:600,local:900,return:-300,other:999});
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM audit_events WHERE organization_id='qa'").get()!.count,1);
  } finally { f.close(); }
});

test("first cost does not certify historical missing amounts; duplicate SKUs never pick an arbitrary product",async()=>{
  const f=fixture();try{
    const cutoff=Date.parse('2026-09-15T18:00:00Z');
    f.sqlite.exec(`INSERT INTO commerce_products VALUES ('qa','pos','one','p1','DUP',0,0,NULL),('qa','pos','one','p2','DUP',0,900,NULL);
      UPDATE commerce_products SET id=external_product_id,owner_cost_updated_at=${cutoff};
      INSERT INTO commerce_sale_lines VALUES
        ('past','qa','pos','one','s1','1','p1','DUP',1000,100,0,1,'2026-09-15T17:59:59Z','shop'),
        ('zero','qa','pos','one','s2','1','p1','DUP',1000,100,0,1,'2026-09-15T18:00:00Z','shop'),
        ('ambiguous','qa','pos','one','s3','1',NULL,'DUP',1000,100,0,1,'2026-09-15T18:00:00Z','shop'),
        ('gift','qa','pos','one','s4','1','missing','FREE',1000,0,0,1,'2026-09-15T18:00:00Z','shop');`);
    const result=await applyOwnerInventoryCosts('qa','one',cutoff,{publishDailyMetrics:false});
    assert.equal(result.missingCostLines,3,'A zero revenue gift can still consume stock and require a cost');
    assert.equal(f.sqlite.prepare("SELECT cost_known known FROM commerce_sale_lines WHERE id='zero'").get()!.known,1);
    assert.equal(f.sqlite.prepare("SELECT cost_known known FROM commerce_sale_lines WHERE id='past'").get()!.known,0);
    assert.equal(f.sqlite.prepare("SELECT cost_cents cost FROM commerce_sale_lines WHERE id='ambiguous'").get()!.cost,0);
  }finally{f.close();}
});

test("dated costs and daily margins use the completed parent receipt rather than line creation time",async()=>{
  const f=fixture();try{
    const cutoff=Date.parse('2026-09-15T18:00:00Z');
    f.sqlite.exec(`INSERT INTO integration_connections VALUES ('one','qa','connected','approved');
      INSERT INTO commerce_products VALUES ('qa','lightspeed-r','one','p1','SKU1',0,300,NULL);
      UPDATE commerce_products SET id='qa-product',owner_cost_updated_at=${Date.parse('2026-09-01T00:00:00Z')};
      INSERT INTO commerce_sale_lines VALUES
        ('after','qa','lightspeed-r','one','s-after','1','p1','SKU1',1000,900,0,1,'2026-09-14T18:00:00Z','shop'),
        ('before','qa','lightspeed-r','one','s-before','1','p1','SKU1',1000,900,0,1,'2026-09-15T18:01:00Z','shop'),
        ('draft','qa','lightspeed-r','one','s-draft','1','p1','SKU1',1000,900,0,1,'2026-09-15T19:00:00Z','shop');
      INSERT INTO integration_staged_sales(organization_id,provider,connection_id,external_sale_id,cost_cents,id,sold_at,state,staged_at,external_version) VALUES
        ('qa','lightspeed-r','one','s-after',0,'s-after','2026-09-16T01:00:00Z','completed',1,'1'),
        ('qa','lightspeed-r','one','s-before',0,'s-before','2026-09-15T17:00:00Z','completed',1,'1'),
        ('qa','lightspeed-r','one','s-draft',0,'draft-first','2026-09-15T19:00:00Z','completed',1,'1'),
        ('qa','lightspeed-r','one','s-draft',0,'draft-latest','2026-09-15T19:00:00Z','open',2,'2'),
        ('other','lightspeed-r','one','s-before',999,'foreign-parent','2026-09-15T19:00:00Z','completed',3,'1');
      INSERT INTO daily_business_metrics VALUES ('qa','one','2026-09-14','lightspeed-r:shop',111,1),('qa','one','2026-09-15','lightspeed-r:shop',0,1);`);
    await f.database.batch(await prepareOwnerCostChange(f.database,{request:new Request('https://vanteloq.example/api/v1/inventory-costs'),requestId:'fictional',organizationId:'qa',userId:'owner',productId:'qa-product',source:'manual',unitCostCents:600,now:cutoff}));
    const result=await applyOwnerInventoryCosts('qa','one',cutoff+1);
    const costs=Object.fromEntries(f.sqlite.prepare('SELECT id,cost_cents cost FROM commerce_sale_lines').all().map(row=>[row.id,row.cost]));
    assert.deepEqual(costs,{after:600,before:300,draft:0});
    assert.equal(result.missingCostLines,1);
    assert.equal(f.sqlite.prepare("SELECT cost_of_goods_cents cost FROM daily_business_metrics WHERE business_date='2026-09-14'").get()!.cost,111,'line creation dates must not move completed revenue into an earlier day');
    assert.equal(f.sqlite.prepare("SELECT cost_of_goods_cents cost FROM daily_business_metrics WHERE business_date='2026-09-15'").get()!.cost,900);
  }finally{f.close();}
});

test("same-millisecond edits have deterministic cutovers and history cannot commit without its product",async()=>{
  const f=fixture();try{
    const cutoff=Date.parse('2026-09-15T18:00:00Z');
    f.sqlite.exec(`INSERT INTO integration_connections VALUES ('one','qa','connected','approved');
      INSERT INTO commerce_products VALUES ('qa','pos','one','p1','SKU1',0,NULL,NULL); UPDATE commerce_products SET id='p1',owner_cost_updated_at=NULL;`);
    const change=(unitCostCents:number,productId='p1')=>prepareOwnerCostChange(f.database,{request:new Request('https://vanteloq.example/api/v1/inventory-costs'),requestId:'fictional',organizationId:'qa',userId:'owner',productId,source:'manual',unitCostCents,now:cutoff});
    await f.database.batch(await change(300)); await f.database.batch(await change(600));
    const rows=f.sqlite.prepare("SELECT json_extract(details_json,'$.effectiveAtMs') instant FROM audit_events ORDER BY instant").all();
    assert.deepEqual(rows.map(row=>row.instant),[cutoff,cutoff+1]);
    const rejected=await change(900,'missing'); await assert.rejects(()=>f.database.batch(rejected));
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) count FROM audit_events').get()!.count,2);
    assert.equal(ownerCostInstant(1_700_000_000),1_700_000_000_000);
    assert.equal(ownerCostInstant(1_700_000_000_001),1_700_000_000_001);
  }finally{f.close();}
});

test("populated owner cost history uses tenant, product and line indexes without repeated audit scans",async t=>{
  const f=fixture();try{
    f.sqlite.exec('BEGIN');
    const product=f.sqlite.prepare("INSERT INTO commerce_products(organization_id,provider,connection_id,external_product_id,sku,owner_cost_cents,owner_cost_updated_at,id) VALUES ('qa','pos','one',?,?,400,?,?)");
    const line=f.sqlite.prepare("INSERT INTO commerce_sale_lines(id,organization_id,provider,connection_id,external_sale_id,external_line_id,product_ref,sku,quantity_milli,net_sales_cents,cost_cents,updated_at,sold_at,outlet_ref) VALUES (?,'qa','pos','one',?,'1',?,?,1000,900,300,1,'2026-09-14T18:00:00Z','shop')");
    const history=f.sqlite.prepare("INSERT INTO audit_events(id,organization_id,action,resource_type,resource_id,outcome,details_json,created_at) VALUES (?,'qa','inventory.cost_effective','inventory_product_cost',?,'success',?,1)");
    const cutoff=Date.parse('2026-09-10T00:00:00Z');
    for(let p=0;p<100;p++){
      product.run(`p${p}`,`SKU${p}`,cutoff,`product${p}`);
      for(let version=0;version<5;version++) history.run(`h${p}-${version}`,`product${p}`,JSON.stringify({version:1,connectionId:'one',unitCostCents:300+25*version,effectiveAtMs:cutoff+version,previousUnitCostCents:null,previousEffectiveAtMs:null}));
    }
    for(let i=0;i<20000;i++)line.run(`line${i}`,`sale${i}`,`p${i%100}`,`SKU${i%100}`);
    f.sqlite.exec('COMMIT');
    const before=performance.now(); await applyOwnerInventoryCosts('qa','one',cutoff+10,{publishDailyMetrics:false});
    t.diagnostic(`20,000 lines / 100 costed products / 500 history events in ${Math.round(performance.now()-before)}ms (local SQLite, not a hosted capacity claim)`);
    assert.equal(f.sqlite.prepare('SELECT SUM(cost_cents) total FROM commerce_sale_lines').get()!.total,8_000_000);
    const updates=f.executions.filter(row=>row.sql.includes('priced_lines AS MATERIALIZED'));
    assert.equal(updates.length,100);
    const plan=f.sqlite.prepare('EXPLAIN QUERY PLAN '+updates[0].sql).all(...updates[0].args).map(row=>String(row.detail)).join('\n');
    assert.match(plan,/commerce_sale_lines_product_date_idx/);
    assert.match(plan,/commerce_sale_lines_id_unique/);
    assert.doesNotMatch(plan,/audit_events/);
    const audit=f.executions.find(row=>row.sql.includes('FROM audit_events event'))!;
    const auditPlan=f.sqlite.prepare('EXPLAIN QUERY PLAN '+audit.sql).all(...audit.args).map(row=>String(row.detail)).join('\n');
    assert.match(auditPlan,/audit_events_workspace_created_idx/);
    assert.equal(f.executions.filter(row=>row.sql.includes('FROM audit_events event')).length,1);
    // Unchanged refreshes retain recorded timestamps instead of re-stamping every historic line.
    await applyOwnerInventoryCosts('qa','one',cutoff+20,{publishDailyMetrics:false});
    assert.equal(f.sqlite.prepare('SELECT MAX(updated_at) stamp FROM commerce_sale_lines').get()!.stamp,cutoff+10);
  }finally{f.close();}
});
