import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { connectorHealth, connectorNextStep, type Connector } from "../domain/connector-guidance.ts";

// Render the actual account JSX in isolation from DataHub's authenticated loading.
// This checks its controls and handlers without duplicating their rendering rules.
const source = ts.createSourceFile("vanteloq-app.tsx", readFileSync(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNode(node: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node | undefined {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => findNode(child, predicate));
}
const accountList = findNode(source, node => ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
  ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "className" && attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === "provider-account-list"));
assert.ok(accountList, "the real connected-account list must exist");
const account = findNode(accountList, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "article"
  && node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "key"
    && attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression?.getText(source) === "connection.id"));
assert.ok(account, "the real per-account controls must exist");
const bindings = `provider, connection, index, accountLabel, accountHealth, connectionAction, providerAction, resourceError, resourceErrorId,
  isMarketingProvider, isQuickBooks, isSlack, isDeel, isMoneris, hasLocationMapping, actionableProvider, canManageProvider, disabledReason,
  formatRelativeSync, humanizeIdentifier, dataReadinessStateLabels, reviewedMarketingSamples, setReviewedMarketingSamples,
  AutomaticSyncControl, loadConnections, connectProvider, setMonerisFormOpen, setQuickBooksConsentOpen, setDeelConsentOpen, setShopifyConnectProvider,
  loadMarketingResources, syncMarketingProvider, requestConnectionDataApproval, SlackChannelActions, testSlackConnection, shareSlackWorkspace,
  syncDeelConnection, stageProviderSample, loadProviderLocations, dataApprovalTriggerRef, setPendingDataApproval, disconnectProvider`;
const compiled = ts.transpileModule(`function FixtureAccount(scope) { const { ${bindings} } = scope; return (${account.getText(source)}); }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
}).outputText;
const renderAccount = new Function("React", `${compiled}\nreturn FixtureAccount;`)(React) as (scope: Record<string, unknown>) => React.ReactElement;

const now = Date.parse("2026-09-25T12:00:00Z");
const provider: Connector = {
  id: "square", name: "Square", category: "Point of sale", availability: "credentials_required",
  status: "connected", dataPromotionStatus: "approved", lastSuccessfulSyncAt: "2026-09-25T11:55:00Z",
  providerReadiness: { credentialsConfigured: true, mode: "production", liveDataEligible: true },
};
const healthy = { id: "fictional-healthy", status: "connected", dataPromotionStatus: "approved", lastSuccessfulSyncAt: provider.lastSuccessfulSyncAt,
  externalAccountName: "Fictional healthy seller", maskedAccountRef: "•••• 0001", lastErrorCode: null, resourceSelections: [], sampleSummary: null, automaticSync: null, syncActive: false };
const expired = { ...healthy, id: "fictional-expired", status: "error", externalAccountName: "Fictional expired seller", lastErrorCode: "SQUARE_AUTHORIZATION_EXPIRED" };
const noop = () => {};
function scope(connection: typeof healthy | typeof expired = expired, changes: Record<string, unknown> = {}) {
  return {
    provider, connection, index: 0, accountLabel: connection.externalAccountName,
    accountHealth: connectorHealth({ ...provider, ...connection, connections: undefined }, { now }),
    connectionAction: "", providerAction: "", resourceError: null, resourceErrorId: "fictional-resource-error",
    isMarketingProvider: false, isQuickBooks: false, isSlack: false, isDeel: false, isMoneris: false, hasLocationMapping: true,
    actionableProvider: "square", canManageProvider: true, disabledReason: "",
    formatRelativeSync: (value: string) => value, humanizeIdentifier: (value: string) => value.replaceAll("_", " "),
    dataReadinessStateLabels: {}, reviewedMarketingSamples: {}, setReviewedMarketingSamples: noop,
    AutomaticSyncControl: () => null, loadConnections: noop, connectProvider: noop, setMonerisFormOpen: noop,
    setQuickBooksConsentOpen: noop, setDeelConsentOpen: noop, setShopifyConnectProvider: noop,
    loadMarketingResources: noop, syncMarketingProvider: noop, requestConnectionDataApproval: noop, SlackChannelActions: () => null,
    testSlackConnection: noop, shareSlackWorkspace: noop, syncDeelConnection: noop, stageProviderSample: noop, loadProviderLocations: noop,
    dataApprovalTriggerRef: { current: null }, setPendingDataApproval: noop, disconnectProvider: noop, ...changes,
  };
}
function buttons(element: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(element)) return element.flatMap(buttons);
  if (!React.isValidElement<{ children?: React.ReactNode }>(element)) return [];
  return element.type === "button" ? [element as React.ReactElement<Record<string, unknown>>] : buttons(element.props.children);
}
const reconnectButton = (fixture: Record<string, unknown>) => {
  const button = buttons(renderAccount(fixture)).find(item => item.props.children === "Reconnect account");
  assert.ok(button, "the account must have a reconnect control");
  return button;
};

test("a failed sibling has its own recovery control while the healthy account retains sync", () => {
  const mixed = { ...provider, connections: [healthy, expired] };
  assert.equal(connectorNextStep(mixed, true, true).stage, "Reconnect account");
  const healthyHtml = renderToStaticMarkup(renderAccount(scope(healthy)));
  const failedHtml = renderToStaticMarkup(renderAccount(scope()));
  assert.match(healthyHtml, /Re-sync now/);
  assert.doesNotMatch(healthyHtml, /Reconnect account/);
  assert.match(failedHtml, /aria-label="Reconnect Square account Fictional expired seller"/);
  assert.match(failedHtml, /aria-describedby="connection-recovery-fictional-expired"/);
  assert.match(failedHtml, /id="connection-recovery-fictional-expired"/);
  assert.match(failedHtml, /choose this same business account/);
  assert.match(failedHtml, />Disconnect</);
  assert.doesNotMatch(failedHtml, /Re-sync now|Review sample|Map locations|Approve reviewed data/);
});

test("expired access cannot expose sync controls even while the stored status remains connected", () => {
  const stillConnected = { ...expired, status: "connected" };
  const html = renderToStaticMarkup(renderAccount(scope(stillConnected)));
  assert.match(html, />Reconnect account</);
  assert.match(html, />Disconnect</);
  assert.doesNotMatch(html, /Re-sync now|Review sample|Map locations|Approve reviewed data/);
});

test("role, plan and provider availability restrictions still disable recovery", () => {
  for (const disabledReason of ["Ask a workspace owner to make changes.", "Starter plan required.", "Coming Soon", "This connection is temporarily unavailable."]) {
    const button = reconnectButton(scope(expired, { disabledReason, canManageProvider: false }));
    assert.equal(button.props.disabled, true, disabledReason);
    assert.equal(button.props.title, disabledReason);
  }
});

test("account actions, provider authorization and active leases prevent duplicate recovery", () => {
  for (const changes of [{ connectionAction: "disconnect" }, { providerAction: "authorize" }, { connection: { ...expired, syncActive: true } }]) {
    const fixture = scope(expired, changes);
    const controls = buttons(renderAccount(fixture));
    const button = controls.find(item => String(item.props["aria-label"]).startsWith("Reconnect Square"));
    assert.ok(button);
    assert.equal(button.props.disabled, true);
  }
});

test("recovery uses existing provider authorization and retains the exact disconnect target", () => {
  const authorized: unknown[] = [], disconnected: unknown[][] = [];
  const fixture = scope(expired, { connectProvider: (id: string) => authorized.push(id), disconnectProvider: (...args: unknown[]) => disconnected.push(args) });
  (reconnectButton(fixture).props.onClick as () => void)();
  assert.deepEqual(authorized, ["square"]);
  const disconnect = buttons(renderAccount(fixture)).find(item => item.props.children === "Disconnect");
  assert.ok(disconnect);
  (disconnect.props.onClick as () => void)();
  assert.deepEqual(disconnected, [["square", expired.id, expired.externalAccountName]]);
});

test("providers with existing consent or account forms reopen those same forms", () => {
  for (const [id, flag, setter, expected] of [
    ["moneris", "isMoneris", "setMonerisFormOpen", true],
    ["quickbooks", "isQuickBooks", "setQuickBooksConsentOpen", true],
    ["deel", "isDeel", "setDeelConsentOpen", true],
    ["shopify", "", "setShopifyConnectProvider", "shopify"],
    ["shopify-pos", "", "setShopifyConnectProvider", "shopify-pos"],
  ] as const) {
    const calls: unknown[] = [];
    const fixture = scope(expired, { provider: { ...provider, id, name: id }, ...(flag ? { [flag]: true } : {}), [setter]: (value: unknown) => calls.push(value), connectProvider: () => assert.fail("the provider's existing form must not be bypassed") });
    (reconnectButton(fixture).props.onClick as () => void)();
    assert.deepEqual(calls, [expected], id);
  }
});
