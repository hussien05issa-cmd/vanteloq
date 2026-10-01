import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { revenueAttribution } from "../server/revenue-attribution";
import RevenueSourceDetail from "../app/revenue-source-detail";

const options = { from: "2026-08-23", to: "2026-08-24", expectedCents: 15000, revealSources: true, now: Date.parse("2026-08-25T00:00:00Z") };
const rows = [
  { businessDate: "2026-08-23", netSalesCents: 10000, sourceProvider: "square", sourceConnectionId: "square-a", updatedAt: "2026-08-23T12:00:00Z" },
  { businessDate: "2026-08-24", netSalesCents: -2000, sourceProvider: "square", sourceConnectionId: "square-a", updatedAt: "2026-08-24T12:00:00Z" },
  { businessDate: "2026-08-23", netSalesCents: 3000, sourceProvider: "shopify", sourceConnectionId: "shopify-a", updatedAt: "2026-08-23T14:00:00Z" },
  { businessDate: "2026-08-24", netSalesCents: 4000, sourceProvider: "shopify", sourceConnectionId: "shopify-a", updatedAt: "2026-08-24T14:00:00Z" },
  { businessDate: "2026-08-22", netSalesCents: 99000, sourceProvider: "square", sourceConnectionId: "square-a", updatedAt: "2026-08-22T12:00:00Z" },
];

test("revenue contributions reconcile exactly within the chosen dates, including negative return days", () => {
  const result = revenueAttribution(rows, options)!;
  assert.equal(result.totalCents, 15000);
  assert.equal(result.recordCount, 4);
  assert.deepEqual(result.sources.map(row => [row.label, row.cents]), [["Square",8000],["Shopify",7000]]);
  assert.equal(result.sources[0].updatedAt, "2026-08-23T12:00:00.000Z");
});

test("unknown or future import times cannot masquerade as fresh records", () => {
  for (const updatedAt of [null, undefined, "invalid", "2027-01-01T12:00:00Z", 0]) {
    const result = revenueAttribution([{...rows[0],updatedAt}], {...options,expectedCents:10000})!;
    assert.equal(result.sources[0].updatedAt, null);
  }
  const mixed = revenueAttribution([{...rows[0],updatedAt:null},rows[1]], {...options,expectedCents:8000})!;
  assert.equal(mixed.sources[0].updatedAt,null);
});

test("attribution honours hidden metadata and unavailable metrics", () => {
  const result = revenueAttribution(rows, {...options,revealSources:false})!;
  assert.deepEqual(result.sources.map(row=>[row.key,row.label,row.cents]), [["approved","Approved sales records",15000]]);
  assert.equal(revenueAttribution(rows,{...options,expectedCents:null}),null);
  assert.equal(revenueAttribution([],{...options,expectedCents:0}),null);
  assert.throws(()=>revenueAttribution(rows,{...options,expectedCents:15001}),/does not reconcile/);
  assert.throws(()=>revenueAttribution([{...rows[0],netSalesCents:1.5}],{...options,expectedCents:1.5}),/integer cents/);
});

test("source UI preserves exact cents, labels missing times and exposes a native records action", () => {
  const attribution = revenueAttribution([{...rows[0],netSalesCents:-201,updatedAt:null}],{...options,expectedCents:-201});
  const html = renderToStaticMarkup(<RevenueSourceDetail attribution={attribution} currency="CAD" onOpenRecords={()=>{}}/>);
  assert.match(html, /Square/);
  assert.match(html, /-\$2\.01/);
  assert.match(html, /Import time unavailable/);
  assert.match(html, /<button type="button">View Source Data/);
  assert.match(html, /Sales tax is excluded/);
  assert.doesNotMatch(html, /just now|Updated 34|84,392/);
});