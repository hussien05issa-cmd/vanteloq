import assert from "node:assert/strict";
import test from "node:test";
import { fileProvider, remoteFileId, selectedSheetRange, sheetSnapshot, snapshotCsv } from "../domain/linked-files.ts";
import { parseDailyCsv } from "../domain/daily-summary-csv.ts";
test("linked table preserves underlying cents and missing values through the reviewed import",()=>{
  const snapshot=sheetSnapshot([["business_date","gross_sales","net_sales","cogs","transactions","units","labour_cost","location"],["2026-09-26",1234.56,1200.01,500.09,2,3,null,'Main, "West"']]);
  const [row]=parseDailyCsv(snapshotCsv(snapshot)); assert.equal(row.grossSalesCents,123456); assert.equal(row.netSalesCents,120001); assert.equal(row.costOfGoodsCents,50009); assert.equal(row.labourCostCents,null); assert.equal(row.locationRef,'Main, "West"');
});
test("full tab bounds cannot silently omit populated cells beyond blank gaps",()=>{
  assert.equal(selectedSheetRange("Owner's Table"),"'Owner''s Table'"); const rows=Array.from({length:1002},()=>[] as string[]); rows[1001]=["Outside the old fetch window"]; assert.throws(()=>sheetSnapshot(rows)); assert.equal(sheetSnapshot(Array.from({length:1001},()=>Array(52).fill(""))).rows.length,1000); assert.throws(()=>sheetSnapshot([Array(53).fill(1)]));
});
test("oversized, nonfinite and unsupported cells are rejected",()=>{
  for (const value of [NaN,Infinity,{},undefined,"x".repeat(4001)]) assert.throws(()=>sheetSnapshot([[value]])); assert.throws(()=>sheetSnapshot(Array.from({length:100},()=>["x".repeat(4000)]))); assert.throws(()=>snapshotCsv({headers:["x"],rows:[],truncated:true}));
});
test("source identifiers and sheet names cannot inject URLs or ranges",()=>{
  assert.equal(fileProvider("google-files"),"google-files"); assert.equal(remoteFileId("AB!a_bc-123"),"AB!a_bc-123"); for (const value of ["https://evil.invalid","../private","x?fields=secret",""]) assert.throws(()=>remoteFileId(value)); assert.throws(()=>fileProvider("google")); assert.throws(()=>selectedSheetRange("bad\nname"));
});
