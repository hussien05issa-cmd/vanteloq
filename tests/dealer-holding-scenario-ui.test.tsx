import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import DealerHoldingScenario, { DealerHoldingResults } from "../app/dealer-holding-scenario";
import { dealerHoldingScenario } from "../domain/dealer-holding-scenario";
const stock = { stockNumber: "TEST-ONE", currency: "CAD", ownership: "owned" as const, availability: "available" as const, postedCostCents: 2000000, costComplete: true, askingCents: 2700000 };
const permissions = { costs: true, profit: true };
test("denied cost or profit access hides the whole calculator even with populated amounts", () => {
  assert.equal(renderToStaticMarkup(<DealerHoldingScenario stock={stock} permissions={{ costs: false, profit: true }}/>), "");
  assert.equal(renderToStaticMarkup(<DealerHoldingScenario stock={stock} permissions={{ costs: true, profit: false }}/>), "");
});
test("the review begins with blank assumptions and labels asking price as an unconfirmed reference", () => {
  const html = renderToStaticMarkup(<DealerHoldingScenario stock={stock} permissions={permissions}/>);
  assert.match(html, /Reviewed complete posted cost/);
  assert.match(html, /20,000.00/);
  assert.match(html, /An asking amount is not a confirmed offer/);
  assert.match(html, /excluded costs already in the posted-cost total/);
  assert.equal((html.match(/value=""/g) ?? []).length, 4);
  assert.doesNotMatch(html, /Scenario estimate before unprovided costs/);
});
test("incomplete or consignment costs provide a review gate without a calculation form", () => {
  for (const row of [{ ...stock, costComplete: false }, { ...stock, ownership: "consignment" as const }]) {
    const html = renderToStaticMarkup(<DealerHoldingScenario stock={row} permissions={permissions}/>);
    assert.doesNotMatch(html, /<form|20,000.00/);
  }
});
test("scenario results retain negative amounts and identify equal-terms assumptions", () => {
  const result = dealerHoldingScenario(stock, permissions, { offerNowCents: 1800000, futurePriceCents: 1900000, dailyHoldingCents: 5000, waitingDays: 20, additionalCostConfirmed: true });
  const html = renderToStaticMarkup(<DealerHoldingResults result={result} currency="CAD"/>);
  assert.match(html, /Scenario estimate before unprovided costs/);
  assert.match(html, /-CAD(?:&nbsp;|\s)2,000.00/);
  assert.match(html, /all other costs and terms are equal/);
});
