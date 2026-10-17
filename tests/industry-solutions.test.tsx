import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SolutionsPage, { metadata as hubMetadata } from "../app/solutions/page";
import SectorSolutionPage, { generateMetadata, generateStaticParams } from "../app/solutions/[sector]/page";
import { getSolutionSector, SOLUTION_SECTORS } from "../app/solutions/content";
import { getArticle } from "../app/resources/content";
import { resolveIndustryTemplate } from "../domain/industry-templates";
import { sectorKindsFor, sectorReport, type SectorContent } from "../domain/sector-operations";
import { costRecipe } from "../domain/foodservice";

test("industry solutions resolve supported templates and published source guides", () => {
  assert.deepEqual(generateStaticParams(), [{ sector: "dealerships" }, { sector: "cafes" }, { sector: "restaurants" }]);
  assert.equal(getSolutionSector("retail"), undefined, "The existing static retail route keeps its own page");
  assert.equal(getSolutionSector("unknown"), undefined);
  for (const sector of SOLUTION_SECTORS) {
    const template = resolveIndustryTemplate(sector.industryId);
    assert.equal(template.id, sector.industryId);
    const workflows = sectorKindsFor({ templateId: template.id, capabilities: [...template.capabilities] });
    assert.ok(workflows.includes(sector.industryId === "dealership" ? "dealer_funding" : "prep_plan"));
    for (const guide of sector.guides) assert.ok(getArticle(guide.href.slice("/resources/".length)), `${sector.slug} links to an unpublished guide`);
  }
});

test("each industry has distinct metadata with its own canonical route", async () => {
  const titles = new Set([hubMetadata.title]);
  const descriptions = new Set([hubMetadata.description]);
  assert.equal(hubMetadata.alternates?.canonical, "/solutions");
  for (const sector of SOLUTION_SECTORS) {
    const metadata = await generateMetadata({ params: Promise.resolve({ sector: sector.slug }) });
    assert.equal(metadata.alternates?.canonical, `/solutions/${sector.slug}`);
    assert.equal(metadata.openGraph?.url, `/solutions/${sector.slug}`);
    assert.ok(!titles.has(metadata.title), "Duplicate search title");
    assert.ok(!descriptions.has(metadata.description), "Duplicate search description");
    titles.add(metadata.title);
    descriptions.add(metadata.description);
  }
  assert.deepEqual((await generateMetadata({ params: Promise.resolve({ sector: "unknown" }) })).robots, { index: false, follow: false });
  await assert.rejects(() => SectorSolutionPage({ params: Promise.resolve({ sector: "unknown" }) }), /NEXT_HTTP_ERROR_FALLBACK;404/);
});

test("rendered pages expose one main heading, valid breadcrumbs and a working skip target", async () => {
  const hub = renderToStaticMarkup(createElement(SolutionsPage));
  const pages = [hub];
  for (const sector of SOLUTION_SECTORS) {
    const html = renderToStaticMarkup(await SectorSolutionPage({ params: Promise.resolve({ sector: sector.slug }) }));
    pages.push(html);
    assert.match(html, /Fictional illustration/);
    assert.match(html, /Fictional amounts, not a customer result/);
    assert.ok(html.includes(sector.tool.href));
    assert.ok(html.includes(`https://vanteloq.com/solutions/${sector.slug}`));
    assert.match(html, new RegExp(`<a\\b(?=[^>]*href="/solutions/${sector.slug}")(?=[^>]*aria-current="page")`));
  }
  for (const html of pages) {
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
    assert.equal((html.match(/<main[ >]/g) ?? []).length, 1);
    assert.match(html, /href="#discovery-main"/);
    assert.match(html, /id="discovery-main"/);
    assert.match(html, /"@type":"BreadcrumbList"/);
    assert.match(html, /href="\/book-demo"/);
    assert.match(html, /href="\/\?start=signup&amp;plan=free"/);
    assert.match(html, /href="\/demo"/);
    assert.doesNotMatch(html, /[\u2013\u2014]/);
  }
  assert.match(hub, /href="\/solutions\/retail"/);
  assert.match(hub, /href="\/tools\/cash-order-planner"/);
  assert.match(hub, /href="\/tools\/vehicle-holding-cost"/);
});

test("advertised fictional amounts agree with the operational calculation contract", () => {
  const content = (kind: SectorContent["kind"], values: SectorContent["values"]): SectorContent => ({ kind, title: "Fictional public illustration", source: "Fictional source records", sourceDate: "2026-10-01", dueDate: "", currency: "CAD", notes: "", values, batch: null });
  const minor = (value: string) => Math.round(Number(value.replace(/^C\$|,/g, "")) * 100);
  const dealerExample = getSolutionSector("dealerships")!.example;
  const funding = sectorReport(content("dealer_funding", { fundingExpected: minor(dealerExample.rows[0].value), fundingReceived: minor(dealerExample.rows[1].value) }));
  assert.equal(funding.metrics.find(metric => metric.label === "Lender funding outstanding")?.value, minor(dealerExample.result));
  const restaurantExample = getSolutionSector("restaurants")!.example;
  const delivery = sectorReport(content("delivery_order", { netSales: minor(restaurantExample.rows[0].value), fees: minor(restaurantExample.rows[1].value), adjustments: 0, foodCost: minor(restaurantExample.rows[2].value), packaging: minor(restaurantExample.rows[3].value), incrementalLabour: 0, taxTips: 400, payout: 4000 }));
  assert.equal(delivery.metrics.find(metric => metric.label === "Order contribution")?.value, minor(restaurantExample.result));
  assert.equal(delivery.metrics.find(metric => metric.label === "Expected settlement")?.value, 4200);
  assert.equal(delivery.metrics.find(metric => metric.label === "Unreconciled settlement")?.value, 200);
  const cafeExample = getSolutionSector("cafes")!.example;
  const recipe = costRecipe({ currency: "CAD", portions: cafeExample.rows[1].value, ingredients: [{ id: "reviewed-batch", purchaseQuantity: { amount: "1", unit: "each" }, purchaseCost: { minor: minor(cafeExample.rows[0].value), currency: "CAD" }, recipeQuantity: { amount: "1", unit: "each" }, preparationYield: "1" }] });
  assert.equal(recipe.status, "available");
  if (recipe.status === "available") assert.equal(recipe.value.perPortionMinor, minor(cafeExample.result));
});
