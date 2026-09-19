import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import PublicPlanCards from "../app/public-plan-cards";
import { ADDONS, PLANS } from "../server/entitlements/catalog.ts";

test("public pricing distinguishes standalone BookLoQ from the Vanteloq add-on", () => {
  assert.equal(PLANS.bookloq.prices.month.amountCents, 5_900);
  assert.equal(PLANS.bookloq.prices.month.lookupKey, "bookloq_standalone_monthly_cad");
  assert.equal(ADDONS.bookloq.prices.month.amountCents, 3_900);
  assert.equal(ADDONS.bookloq.prices.month.lookupKey, "bookloq_monthly_cad");

  const markup = renderToStaticMarkup(<PublicPlanCards/>);
  assert.match(markup, /BookLoQ on its own/i);
  assert.match(markup, /\$59<small> CAD \/ month<\/small>/);
  assert.match(markup, /\+\$39 CAD \/ month/);
  assert.match(markup, /BookLoQ is available for \$39 CAD with a Vanteloq plan or \$59 CAD on its own\./);
  assert.match(markup, /start=signup&amp;plan=bookloq/);
  assert.doesNotMatch(markup, /plan=bookloq&amp;bookloq=1/);
});
