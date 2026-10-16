import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import VanteloqApp from "../app/vanteloq-app";
import Home from "../app/page";
import { BillingEntitlementsProvider, type BillingEntitlements } from "../app/billing-entitlements-context";

const entitlements: BillingEntitlements = {accessType:"free",plan:"free",status:null,addons:[],features:[],limits:{activeLocations:1,users:1,ai:{capability:"basic",requestsPerMonth:0,meteringStatus:"not_launched"}}};

test("signed-in header opens Data Studio through Vanteloq without forwarding account data", () => {
  const html = renderToStaticMarkup(<BillingEntitlementsProvider value={entitlements}><VanteloqApp organizationName="Test business" accountName="Test owner"/></BillingEntitlementsProvider>);
  const links = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]);
  const launcher = links.find(link => /aria-label="Open Vanteloq Data Studio/.test(link));
  assert.ok(launcher, "The authenticated header must include the Data Studio launcher");
  assert.match(launcher, /href="\/datstudio"/);
  assert.match(launcher, /target="_blank"/);
  assert.match(launcher, /rel="noopener noreferrer"/);
  assert.match(launcher, /referrerPolicy="no-referrer"/i);
  assert.match(launcher, /Data Studio/);
  assert.match(launcher, /Open/);
  assert.doesNotMatch(launcher, /[?#]|Test business|Test owner|access_token|user_id/);
});

test("the signed-out landing does not acquire the authenticated Workspace launcher", () => {
  const html = renderToStaticMarkup(<Home/>);
  assert.doesNotMatch(html, /aria-label="Open Vanteloq Data Studio/);
});

