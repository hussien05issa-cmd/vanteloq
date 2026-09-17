import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HomeDecisionPreview from "../app/home-decision-preview";
import { demoAnalysis } from "../domain/product-demo";

test("homepage comparison reconciles both complete periods and identifies fictional data", () => {
  const html = renderToStaticMarkup(<HomeDecisionPreview/>);
  assert.match(html, /CAD · Sample/);
  assert.match(html, /Fictional store records/);
  assert.doesNotMatch(html, /Recorded bank activity|NaN|Infinity/);
  const table = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
  assert.ok(table);
  const rows = [...table.matchAll(/<tr><th[^>]*>[\s\S]*?<\/th><td>(.*?)<\/td><td>(.*?)<\/td><\/tr>/g)];
  assert.equal(rows.length, 4);
  const cents = (value: string) => Math.round(Number(value.replace(/[^0-9.-]/g, "")) * 100);
  const kpis = demoAnalysis("all", "complete").kpis;
  assert.equal(rows.reduce((sum, row) => sum + cents(row[1]), 0), kpis.current!.netSalesCents);
  assert.equal(rows.reduce((sum, row) => sum + cents(row[2]), 0), kpis.previous!.netSalesCents);
  assert.match(html, /Transactions/);
  assert.match(html, /Average basket/);
  assert.match(html, /Gross margin/);
});
