import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { stagedSaleCostVerifiedSql } from "../server/integrations/cost-evidence";
import { salesDay } from "../domain/intraday-sales";

test("live receipt margins require complete cost lines and a matching staged amount",()=>{
  const db=new DatabaseSync(':memory:');try{
    db.exec(`CREATE TABLE integration_staged_sales(id TEXT,organization_id TEXT,provider TEXT,connection_id TEXT,
      external_sale_id TEXT,total_cents INTEGER,tax_cents INTEGER,cost_cents INTEGER,line_count INTEGER);
      CREATE TABLE commerce_sale_lines(organization_id TEXT,provider TEXT,connection_id TEXT,external_sale_id TEXT,
        quantity_milli INTEGER,cost_known INTEGER,cost_cents INTEGER);
      INSERT INTO integration_staged_sales VALUES
        ('zero','qa','lightspeed-r','one','zero',1000,0,0,1),
        ('missing','qa','lightspeed-r','one','missing',1000,0,0,1),
        ('partial','qa','lightspeed-r','one','partial',1000,0,300,2),
        ('mismatch','qa','lightspeed-r','one','mismatch',1000,0,400,1),
        ('good','qa','lightspeed-r','one','good',1000,0,300,1),
        ('cross','qa','lightspeed-r','one','cross',1000,0,0,1),
        ('count','qa','lightspeed-r','one','count',1000,0,300,2),
        ('tax','qa','lightspeed-r','one','tax',1000,1000,0,0);
      INSERT INTO commerce_sale_lines VALUES
        ('qa','lightspeed-r','one','zero',1000,1,0),
        ('qa','lightspeed-r','one','missing',1000,0,0),
        ('qa','lightspeed-r','one','partial',1000,1,300),('qa','lightspeed-r','one','partial',1000,0,0),
        ('qa','lightspeed-r','one','mismatch',1000,1,300),
        ('qa','lightspeed-r','one','good',1000,1,300),
        ('other','lightspeed-r','one','cross',1000,1,0),('qa','lightspeed-r','two','cross',1000,1,0),
        ('qa','lightspeed-r','one','count',1000,1,300);`);
    const results=db.prepare(`SELECT id,${stagedSaleCostVerifiedSql('sale')} known FROM integration_staged_sales sale ORDER BY id`).all();
    assert.deepEqual(Object.fromEntries(results.map(row=>[row.id,row.known])),{
      count:0,cross:0,good:1,mismatch:0,missing:0,partial:0,tax:1,zero:1,
    });
    const day=salesDay([{externalSaleId:'partial',outletRef:'shop',soldAt:'2026-09-14T10:00:00Z',state:'completed',totalCents:1000,taxCents:0,
      costCents:300,costVerified:results.find(row=>row.id==='partial')!.known===1,discountCents:0,lineCount:2}],
      'UTC',new Date('2026-09-14T12:00:00Z'));
    assert.equal(day.netSalesCents,1000); assert.equal(day.grossProfitCents,null); assert.equal(day.missingCostRecords,1);
    assert.throws(()=>stagedSaleCostVerifiedSql('sale; DROP TABLE users'),/Invalid/);
  }finally{db.close();}
});
