import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import FoodserviceWorkspace from "../app/foodservice-workspace";

test("foodservice overview waits for authenticated records and does not render invented metrics or entry forms", () => {
  const html = renderToStaticMarkup(<FoodserviceWorkspace compactOverview activeLocationId="location" onOpen={() => {}}/>);
  assert.match(html,/Foodservice overview/); assert.match(html,/Loading saved foodservice records/); assert.match(html,/Open food-cost workspace/);
  assert.doesNotMatch(html,/<form|Save reviewed record|CAD 0\.00|30\.00%/);
});
test("full foodservice workspace states the ledger boundary before data loads", () => {
  const html = renderToStaticMarkup(<FoodserviceWorkspace activeLocationId={null}/>);
  assert.match(html,/Recipe and food-cost review/); assert.match(html,/do not post to BookLoQ or change stock balances/);
});
