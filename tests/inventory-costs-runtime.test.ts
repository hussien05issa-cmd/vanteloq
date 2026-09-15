import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyOwnerInventoryCosts } from "../server/inventory-costs";

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
    CREATE TABLE commerce_sale_lines (id TEXT, organization_id TEXT, provider TEXT, connection_id TEXT,
      external_sale_id TEXT, external_line_id TEXT, product_ref TEXT, sku TEXT, quantity_milli INTEGER,
      net_sales_cents INTEGER, cost_cents INTEGER, updated_at INTEGER, sold_at TEXT, outlet_ref TEXT);
    CREATE UNIQUE INDEX commerce_sale_lines_external_unique ON commerce_sale_lines(organization_id,provider,connection_id,external_sale_id,external_line_id);
    CREATE TABLE integration_staged_sales (organization_id TEXT, provider TEXT, connection_id TEXT, external_sale_id TEXT, cost_cents INTEGER);
    CREATE TABLE daily_business_metrics (organization_id TEXT, source_connection_id TEXT, business_date TEXT,
      location_ref TEXT, cost_of_goods_cents INTEGER, updated_at INTEGER);
  `);
  const statements: string[] = [];
  function prepare(sql: string) {
    const statement = sqlite.prepare(sql);
    let args: Array<string | number | null> = [];
    return {
      bind(...values: Array<string | number | null>) { args = values; return this; },
      async run() { statements.push(sql); return statement.run(...args); },
      async first() { statements.push(sql); return statement.get(...args) ?? null; },
      async all() { statements.push(sql); return { results: statement.all(...args) }; },
    };
  }
  const runtime = globalThis as typeof globalThis & { __vanteloqEnv?: unknown };
  const previous = runtime.__vanteloqEnv;
  runtime.__vanteloqEnv = { DB: { prepare, batch: async (items: ReturnType<typeof prepare>[]) => Promise.all(items.map(s => s.run())) } };
  return { sqlite, statements, close() { runtime.__vanteloqEnv = previous; sqlite.close(); } };
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
    const product = f.sqlite.prepare('INSERT INTO commerce_products VALUES (?,?,?,?,?,0,NULL,NULL)');
    const line = f.sqlite.prepare("INSERT INTO commerce_sale_lines VALUES (?,'qa','pos','one',?,'1',?,?,1000,100,0,1,'2026-09-14T18:00:00Z','shop')");
    for (let i=0;i<2000;i++) product.run('qa','pos','one',`p${i}`,`SKU${i}`);
    for (let i=0;i<20000;i++) line.run(`l${i}`,`s${i}`,`p${i%2000}`,`SKU${i%2000}`);
    // An explicit zero is known, and a cost on another tenant is irrelevant.
    f.sqlite.exec("UPDATE commerce_products SET default_cost_cents=0 WHERE external_product_id='p0'; INSERT INTO commerce_products VALUES ('other','pos','one','p1','SKU1',0,900,NULL); COMMIT;");
    const before = performance.now();
    const result = await applyOwnerInventoryCosts('qa','one',42);
    t.diagnostic(`20,000 sale lines / 2,000 products checked in ${Math.round(performance.now()-before)}ms (local SQLite)`);
    assert.equal(result.missingCostLines,19990);
    assert.equal(f.statements.filter(sql => /UPDATE|INSERT|DELETE/.test(sql)).length,0);
    const query = f.statements.find(sql => sql.includes('COUNT(*) AS count'))!;
    const plan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`).all('qa','one').map(r => String(r.detail)).join('\n');
    assert.match(plan,/external_product_id=\?/);
    assert.match(plan,/sku=\?/);
  } finally { f.close(); }
});
