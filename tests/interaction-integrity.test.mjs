import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function applicationSource() {
  const directory = new URL("../app/", import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith(".tsx"));
  return Promise.all(
    files.map(async (file) => ({
      file,
      source: await readFile(new URL(file, directory), "utf8"),
    })),
  );
}

test("visible controls do not use known no-op interaction patterns", async () => {
  for (const { file, source } of await applicationSource()) {
    assert.doesNotMatch(source, /onClick=\{\(\) => undefined\}/, file);
    assert.doesNotMatch(source, /onClick=\{\(\) => \{\}\}/, file);
    assert.doesNotMatch(source, /href=["']#["']/, file);
  }
});

test("provider data approval uses an accessible in-app confirmation", async () => {
  const source = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /window\.confirm\("Make the reviewed records/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-labelledby="data-approval-title"/);
  assert.match(source, /requestConnectionDataApproval/);
  assert.match(source, /Approve reviewed data/);
});

test("BookLoQ connects Plaid directly with versioned consent and guarded financial use", async () => {
  const [workspace, plaidButton, privacy, purchasing] = await Promise.all([
    readFile(new URL("../app/bookloq-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/plaid-link-button.tsx", import.meta.url), "utf8"),
    readFile(new URL("../domain/privacy-controls.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/purchasing/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /<PlaidLinkButton[\s\S]{0,500}returnView="BookLoQ"/);
  assert.match(workspace, /setSection\("Banking"\)\}>Connect a bank/);
  assert.match(workspace, /The authorization checkbox, exact data categories, purposes, retention choices/);
  assert.match(workspace, /Transactions remain unposted until an authorized person categorizes and reconciles them/);
  assert.match(workspace, /action: "approve_data", connectionId: stagedConnection\.id, confirmed: true/);
  assert.match(plaidButton, /PLAID_RETURN_VIEW_STORAGE_KEY/);
  assert.match(plaidButton, /disabled=\{!consentChecked\}/);
  assert.match(privacy, /plaid-financial-data-v3/);
  assert.match(privacy, /13-week cash-flow forecasting/);
  assert.match(privacy, /reorder-capacity analysis when combined with inventory and supplier records/);
  assert.match(purchasing, /Connect and synchronize Plaid in BookLoQ before cash can constrain reorder quantities/);
  assert.match(purchasing, /Demand quantities use verified 30-day performance/);
});

test("literal disabled buttons explain why they are unavailable", async () => {
  for (const { file, source } of await applicationSource()) {
    const literalDisabledButtons = source.match(/<button\b(?=[^>]*\bdisabled(?:\s|>))[^>]*>/g) ?? [];
    for (const button of literalDisabledButtons) {
      assert.match(button, /\btitle=/, `${file}: ${button}`);
    }
  }
});

test("the Lightspeed integration uses the standalone image asset", async () => {
  const source = await readFile(
    new URL("../app/integration-brand-logo.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /\/brand\/lightspeed-mark\.png/);
  assert.doesNotMatch(source, /name === "Lightspeed"[\s\S]{0,200}<path/);
});

test("product branding uses the supplied BookLoQ assets and a shared trademark glyph", async () => {
  const [productLogoSource, homepage, homepageCss] = await Promise.all([
    readFile(new URL("../app/product-brand-logo.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/homepage.css", import.meta.url), "utf8"),
  ]);
  assert.match(productLogoSource, /\/brand\/bookloq-logo-transparent\.png/);
  assert.match(productLogoSource, /\/brand\/bookloq-mark\.png/);
  assert.doesNotMatch(productLogoSource, /bookloq-logo\.jpeg/);
  assert.match(productLogoSource, /brand-trademark/);
  assert.match(productLogoSource, />™<\/sup>/);
  assert.match(homepage, /<ProductBrandLogo product="bookloq"\s*\/>/);
  assert.match(homepageCss, /\.home-product-logo-shell\.bookloq-logo-shell \{[^}]*background:\s*transparent/);
  assert.match(homepageCss, /\.product-brand-logo\.bookloq\.full \{[^}]*background:\s*transparent/);
});

test("Lightspeed Retail X-Series and R-Series are distinct, actionable connection choices", async () => {
  const catalog = await readFile(new URL("../app/integration-catalog.ts", import.meta.url), "utf8");
  const app = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  assert.match(catalog, /id: "lightspeed"[\s\S]*name: "Lightspeed Retail X-Series"/);
  assert.match(catalog, /id: "lightspeed-r"[\s\S]*name: "Lightspeed Retail R-Series"/);
  assert.match(app, /integrations\/\$\{provider\}\/authorize/);
  assert.match(app, /provider === "lightspeed-r" \? "shops" : provider === "clover" \|\| provider === "square" \|\| provider === "shopify" \|\| provider === "shopify-pos" \? "locations" : "outlets"/);
  assert.match(app, /providerActions\[integrationActionKey\(provider\.id, connection\.id\)\]/);
  assert.match(app, /integrationActionKey\(provider, connectionId\)/);
  assert.match(app, /delete next\[actionKey\]/);
  assert.doesNotMatch(app, /disabled=\{[^}]*Boolean\(providerActions\)[^}]*\}/);
});

test("payment-only connections cannot make the command centre claim a live POS source", async () => {
  const commandCentre = await readFile(new URL("../app/api/v1/command-centre/route.ts", import.meta.url), "utf8");
  assert.match(commandCentre, /new Set\(\["lightspeed", "lightspeed-r", "shopify", "shopify-pos", "square", "clover"\]\)/);
  assert.doesNotMatch(commandCentre, /supportedPosProviders[^;]*"moneris"/);
  assert.match(commandCentre, /Payment-only connectors such as Moneris/);
});

test("invoice files stay behind authenticated document downloads", async () => {
  const [invoiceRoute, workspace, documentsRoute] = await Promise.all([
    readFile(new URL("../app/api/v1/bookloq/invoices/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/bookloq-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/documents/route.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(invoiceRoute, /downloadUrl/);
  assert.match(invoiceRoute, /securityState: "clean", source: "application-generated-text-only"/);
  assert.match(invoiceRoute, /'clean', 'approved', 'clean'/);
  assert.match(invoiceRoute, /INVOICE_LOGO_SCAN_UNAVAILABLE/);
  assert.doesNotMatch(workspace, /form\.set\("logo"/);
  assert.match(workspace, /apiFetch\(`\/api\/v1\/documents\?id=/);
  assert.doesNotMatch(workspace, /window\.open\([^)]*documents/);
  assert.match(documentsRoute, /eq\(workspaceDocuments\.organizationId, context\.organizationId\)/);
  assert.match(documentsRoute, /Cache-Control": "private, no-store"/);
});

test("the product story advances automatically and respects reduced motion", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /function FeatureReelStage/);
  assert.match(source, /current => \(current \+ 1\) % featureReelScenes\.length/);
  assert.match(source, /if \(motion\.matches\) return/);
  assert.match(source, /motion\.removeEventListener\("change", updateMotion\)/);
  assert.doesNotMatch(source, /feature-reel-play|setPlaying/);
  assert.doesNotMatch(source, /vanteloq-feature-reel-v1\.webp/);
});

test("R-Series reconciliation warnings keep source records out of live metrics and preserve the retry cursor", async () => {
  const sync = await readFile(new URL("../server/integrations/sync/lightspeed-r.ts", import.meta.url), "utf8");
  assert.match(sync, /const publicationWarnings = normalizationWarnings\.sales \+ unmappedLocations/);
  assert.match(sync, /const publishCanonical = publicationAuthorized && publicationWarnings === 0/);
  assert.match(sync, /const publishedDailyMetrics = publishCanonical \? dailyMetrics : \[\]/);
  assert.match(sync, /publicationWarnings > 0 \? connection\.lastSyncCursor/);
});

test("R-Series backfills are bounded, resumable and recover expired locks without GET mutations", async () => {
  const [sync, connection, integrations] = await Promise.all([
    readFile(new URL("../server/integrations/sync/lightspeed-r.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/integrations/connection.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/integrations/route.ts", import.meta.url), "utf8"),
  ]);
  assert.equal((sync.match(/maxPages:\s*1/g) ?? []).length >= 6, true);
  assert.doesNotMatch(sync, /maxPages:\s*[2-9]/);
  assert.match(sync, /database\.batch\(statements\.slice\(index, index \+ 50\)\)/);
  assert.match(connection, /ttlMs = 5 \* 60_000/);
  assert.match(connection, /sync_lease_expires_at <= \?/);
  const getHandler = integrations.split("export async function GET")[1].split("export async function POST")[0];
  assert.doesNotMatch(getHandler, /\.update\(|\.delete\(|\.insert\(/);
});

test("provider location discovery uses a same-origin write request", async () => {
  const app = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  for (const routePath of [
    "../app/api/v1/integrations/lightspeed/outlets/route.ts",
    "../app/api/v1/integrations/lightspeed-r/shops/route.ts",
  ]) {
    const route = await readFile(new URL(routePath, import.meta.url), "utf8");
    const getHandler = route.split("export async function GET")[1].split("export async function POST")[0];
    assert.doesNotMatch(getHandler, /fetchLightspeed|\.insert\(|\.update\(/, routePath);
    assert.match(route, /input\.action === "discover"/);
  }
  assert.match(app, /method: "POST"[\s\S]{0,180}action: "discover"/);
});

test("R-Series location setup cannot silently leave dashboard data locked", async () => {
  const [app, shops, sync] = await Promise.all([
    readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/integrations/lightspeed-r/shops/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/integrations/sync/lightspeed-r.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(app, /Keep as a separate R-Series location/);
  assert.match(app, /Not mapped — dashboard data stays locked/);
  assert.match(shops, /autoMapped/);
  assert.match(shops, /activeLocalLocations\.length === 1/);
  assert.match(sync, /unmappedLocations/);
  assert.match(sync, /Map or ignore/);
  assert.match(app, /\(provider === "lightspeed" \|\| provider === "lightspeed-r" \|\| provider === "shopify" \|\| provider === "shopify-pos" \|\| provider === "square" \|\| provider === "clover"\) && body\.publicationPending === true/);
  assert.match(app, /stageProviderSample\(provider as [^,]+, connectionId\)/);
});

test("live sales and report time frames stay connected to real API filters", async () => {
  const app = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  const reports = await readFile(new URL("../app/control-workspaces.tsx", import.meta.url), "utf8");
  const reportRoute = await readFile(new URL("../app/api/v1/reports/route.ts", import.meta.url), "utf8");
  const rSeriesSync = await readFile(new URL("../server/integrations/sync/lightspeed-r.ts", import.meta.url), "utf8");
  assert.match(app, /IntradaySalesChart/);
  assert.match(app, /integrations\/lightspeed-r\/sync/);
  assert.match(app, /R-Series refreshes are started from Connections and remain hidden until the latest reconciliation is reviewed/);
  assert.match(reports, /report-period-presets/);
  assert.match(reports, /type="date"/);
  assert.match(reports, /new URLSearchParams\(\{ report: id \}\)/);
  assert.match(reports, /params\.set\("start", start\)/);
  assert.match(reports, /params\.set\("end", end\)/);
  assert.match(reports, /format=csv/);
  assert.match(reportRoute, /INVALID_DATE_RANGE/);
  assert.match(reportRoute, /periodStart: resolvedStart/);
  assert.match(reportRoute, /periodEnd: resolvedEnd/);
  assert.match(reportRoute, /commerce_payments/);
  assert.match(reportRoute, /comparisonPeriod/);
  assert.match(reports, /Month to date/);
  assert.match(reports, /Last month/);
  assert.match(reports, /Payment-method performance/);
  assert.match(rSeriesSync, /recentSalesPage/);
  assert.match(rSeriesSync, /24 \* 60 \* 60 \* 1_000/);
  assert.match(rSeriesSync, /\.\.\.recentSalesPage\.data, \.\.\.salesPage\.data/);
});

test("an unavailable provider report clears its source-specific label before consolidated fallback", async () => {
  const reports = await readFile(new URL("../app/control-workspaces.tsx", import.meta.url), "utf8");
  const unavailableBranch = reports.match(
    /if \(response\.status === 403 && sourceConnectionId\) \{([\s\S]*?)\n\s*\}/,
  );
  assert.ok(unavailableBranch, "Expected a provider-source 403 recovery branch.");
  assert.match(unavailableBranch[1], /setSourceConnectionId\(""\)/);
  assert.match(unavailableBranch[1], /setSourceReportLabel\(""\)/);
});

test("connector and document controls reflect real workflow readiness", async () => {
  const app = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  const controls = await readFile(new URL("../app/control-workspaces.tsx", import.meta.url), "utf8");
  const integrationsRoute = await readFile(new URL("../app/api/v1/integrations/route.ts", import.meta.url), "utf8");
  const readability = await readFile(new URL("../app/readability.css", import.meta.url), "utf8");
  assert.match(app, /Review its shops, then start a sync from Connections/);
  assert.doesNotMatch(app, /Live sales import is starting/);
  assert.match(app, /sampleResult\.readyForReview/);
  assert.match(app, /sampleResult\.run\.warningCount > 0/);
  assert.match(app, /canUpload=\{permissions\.includes\("documents\.upload"\)\}/);
  assert.match(controls, /if \(!canUpload \|\| !file\) return/);
  assert.match(controls, /Document upload access required/);
  assert.doesNotMatch(integrationsRoute, /INTEGRATION_BACKFILL_INCOMPLETE/);
  assert.match(integrationsRoute, /integration_staged_sales/);
  assert.match(readability, /\.operating-shell \.location-switcher select/);
  assert.match(readability, /background:\s*#0b2b4b/);
});

test("team controls follow effective governance permissions", async () => {
  const app = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  const governance = await readFile(new URL("../app/governance-workspaces.tsx", import.meta.url), "utf8");
  assert.match(app, /<TeamWorkspace[\s\S]{0,220}permissions=\{permissions\}/);
  assert.match(governance, /const canCreate = permissions\.includes\("team\.create"\)/);
  assert.match(governance, /const canEdit = permissions\.includes\("team\.edit"\)/);
  assert.match(governance, /const canManageRoles = permissions\.includes\("team\.roles"\)/);
  assert.match(governance, /canCreate && <button className="primary"/);
  assert.match(governance, /canManageRoles && tab === "roles"/);
  assert.match(governance, /role\.systemKey !== "account_owner"/);
});

test("public resources always expose Home and Sign in navigation", async () => {
  const navigation = await readFile(new URL("../app/resources/components.tsx", import.meta.url), "utf8");
  const resources = await readFile(new URL("../app/resources/page.tsx", import.meta.url), "utf8");
  const article = await readFile(new URL("../app/resources/[segment]/page.tsx", import.meta.url), "utf8");
  assert.match(navigation, /href="\/">Home/);
  assert.match(navigation, /href="\/\?start=signin">Sign in/);
  assert.match(resources, /ResourceShell/);
  assert.match(article, /ResourceShell/);
  assert.match(article, /Breadcrumbs/);
});

test("resource article sections override the legacy global two-column rule", async () => {
  const css = await readFile(new URL("../app/resources/resources.css", import.meta.url), "utf8");
  assert.match(css, /\.resource-site \.article-body > section \{[^}]*display:\s*block;[^}]*grid-template-columns:\s*none;[^}]*padding:\s*0;[^}]*border-bottom:\s*0;/);
  assert.match(css, /\.resource-site \.article-body > section > \* \{[^}]*grid-column:\s*auto;/);
  assert.match(css, /\.resource-site \.article-body > section\.quick-answer \{[^}]*padding:\s*30px;/);
});

test("commerce charts expose exact-date and exact-hour keyboard record inspection", async () => {
  const charts = await readFile(new URL("../app/dashboard-charts.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  assert.match(charts, /workspace-chart-readout/);
  assert.match(charts, /<select id=\{.*-record/);
  assert.match(charts, /Net sales.*Gross profit.*Transactions/s);
  assert.match(app, /Latest day vs same weekday/);
  assert.match(app, /PAYMENT MIX/);
  assert.match(app, /7-DAY OUTLOOK/);
});

test("sales payment mix defaults to today and offers verified date windows", async () => {
  const app = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/v1/command-centre/route.ts", import.meta.url), "utf8");
  assert.match(app, /paymentRange/);
  assert.match(app, /Today/);
  assert.match(app, /Last 7 days/);
  assert.match(app, /Last 30 days/);
  assert.match(route, /payment_days/);
  assert.match(route, /PAYMENT_PERIOD_INVALID/);
});

test("integrations open on Connections and never render a raw provider account identifier", async () => {
  const app = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/v1/integrations/route.ts", import.meta.url), "utf8");
  assert.match(app, /useState<"import" \| "connections">\("connections"\)/);
  assert.match(app, /Connections[\s\S]{0,500}Import data/);
  assert.doesNotMatch(app, /Account ID \{provider\.externalAccountRef\}/);
  assert.match(route, /maskedAccountRef/);
  assert.doesNotMatch(route, /externalAccountRef: byProvider/);
});

test("the authenticated dashboard keeps connector management in Connections", async () => {
  const app = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /function ConnectorHomeDirectory/);
  assert.doesNotMatch(app, /home-connector-directory/);
  assert.match(app, /CONNECTIONS AND DATA/);
  assert.match(app, /provider\.dataPromotionStatus === "approved"/);
  assert.match(app, /fresh balances power cash analysis · transactions await review/i);
  assert.match(app, /Connect sources, review the data, then use the results/);
});

test("employee profiles are covered by organization billing and remote seats are capacity checked", async () => {
  const governance = await readFile(new URL("../app/api/v1/governance/route.ts", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../app/governance-workspaces.tsx", import.meta.url), "utf8");
  assert.match(governance, /canAddUser/);
  assert.match(governance, /employeeCheckoutRequired: false/);
  assert.match(workspace, /Covered by the owner plan/);
  assert.match(workspace, /Employees never complete a separate checkout/);
});

test("purchase orders use the tenant product and supplier database with traceable recommendations", async () => {
  const workspace = await readFile(new URL("../app/control-workspaces.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/v1/purchasing/route.ts", import.meta.url), "utf8");
  assert.match(workspace, /Product from product database/);
  assert.match(workspace, /Last ordered/);
  assert.match(workspace, /already incoming/);
  assert.match(route, /label: "Dead stock"/);
  assert.match(route, /Healthy movement/);
  assert.match(route, /commerce_products/);
  assert.match(route, /commerce_suppliers/);
  assert.match(route, /commerce_sale_lines/);
  assert.match(route, /purchase_order_lines/);
  assert.match(route, /PRODUCT_SUPPLIER_MISMATCH/);
  assert.match(route, /reviewHorizonDays: 14/);
  assert.match(route, /supplierSource: selectedSupplier/);
});

test("marketing intelligence is owner-controlled, evidence-labeled and calendar-backed", async () => {
  const workspace = await readFile(new URL("../app/growth-workspace.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/v1/growth/route.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");

  assert.match(workspace, /Owner entry/);
  assert.doesNotMatch(route, /Coming soon!/);
  assert.match(route, /Association is not proof of causation/i);
  assert.match(workspace, /WorkspaceIcon name="Marketing"/);
  assert.doesNotMatch(workspace, /marketing-intelligence-v2\.png/);
  assert.match(workspace, /Google demand and website actions/);
  assert.match(workspace, /Meta reach and website clicks/);
  assert.match(workspace, /Owner-record checklist/);
  assert.match(workspace, /© OpenStreetMap contributors/);
  assert.match(route, /marketing\.profile_updated/);
  assert.match(route, /marketing\.calendar_created/);
  assert.match(route, /sourceSystem: "owner_entry"|sourceSystem/);
  assert.match(schema, /marketing_profiles/);
  assert.match(schema, /marketing_calendar_entries/);
  assert.match(schema, /marketing_daily_metrics/);
  assert.doesNotMatch(schema, /marketing_reviews/);
  assert.match(route, /measurementSeries/);
  assert.match(route, /profileChecklist/);
  assert.doesNotMatch(route, /reviewInsights/);
});

test("sidebar scrolling is bounded and navigation customization lives in Settings", async () => {
  const [app, governance, css] = await Promise.all([
    readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/governance-workspaces.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/operating.css", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(app, /Customize navigation|NavigationEditor/);
  assert.match(app, /NavigationSettingsPanel/);
  assert.match(governance, /Sidebar & workspaces/);
  assert.match(css, /sidebar>nav\{overflow-y:auto;overscroll-behavior:contain\}/);
  assert.doesNotMatch(css, /sidebar>nav\{overflow-y:visible\}/);
});

test("POS integrations use one clean capability view and follow active R-Series syncs", async () => {
  const [app, api, css] = await Promise.all([
    readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/integrations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/operating.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(app, /BEFORE DATA REACHES YOUR DASHBOARD/);
  assert.doesNotMatch(app, /provider-coverage-matrix/);
  assert.match(app, /pos-commerce-intelligence\.png/);
  assert.match(app, /waitForConnectionSync/);
  assert.match(app, /connection\.syncActive/);
  assert.match(api, /syncActive:/);
  assert.match(css, /\.operating-shell \.sidebar>nav\{[^}]*flex:1 1 0!important;[^}]*overflow-y:auto!important/);
});

test("removed industry modules stay out of the authenticated workspace", async () => {
  const workspace = await readFile(new URL("../app/vanteloq-app.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(workspace, /industry-models-v2\.png/);
  assert.doesNotMatch(workspace, /Requires source adapter/);
  assert.doesNotMatch(workspace, /\{industries\.length\}<\/b><small>industry models/);
});

test("the banking catalogue uses Plaid's standalone mark and omits removed aggregators", async () => {
  const logoSource = await readFile(
    new URL("../app/integration-brand-logo.tsx", import.meta.url),
    "utf8",
  );
  const catalogue = await readFile(
    new URL("../app/integration-catalog.ts", import.meta.url),
    "utf8",
  );
  assert.match(logoSource, /\/brand\/plaid-mark\.png/);
  assert.doesNotMatch(catalogue, /\bMX\b|\bFlinks\b/);
  assert.match(catalogue, /name: "Plaid"/);
});

test("Plaid Link opens only after an explicit, accessible financial-data authorization", async () => {
  const button = await readFile(new URL("../app/plaid-link-button.tsx", import.meta.url), "utf8");
  assert.match(button, /role="dialog"/);
  assert.match(button, /aria-modal="true"/);
  assert.match(button, /type="checkbox"/);
  assert.doesNotMatch(button, /type="checkbox"[^>]*defaultChecked|type="checkbox"[^>]*checked=\{true\}/);
  assert.match(button, /Privacy Policy/);
  assert.match(button, /Retention and deletion/);
  assert.match(button, /consentRecordId/);
  assert.match(button, /Vanteloq cannot move money or make payments/);
});

test("account access includes confirmation recovery and a complete password-reset path", async () => {
  const authPanel = await readFile(new URL("../app/auth-panel.tsx", import.meta.url), "utf8");
  const home = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const browserClient = await readFile(new URL("../app/supabase-browser.ts", import.meta.url), "utf8");

  assert.match(authPanel, /resetPasswordForEmail/);
  assert.match(authPanel, /resetPasswordForEmail[\s\S]{0,250}captchaToken: turnstileToken/);
  assert.match(authPanel, /auth\.signUp\([\s\S]{0,900}canonicalAuthUrl/);
  assert.match(authPanel, /fetch\("\/api\/v1\/auth\/signin"[\s\S]{0,400}turnstileToken/);
  assert.match(authPanel, /auth\.setSession/);
  assert.match(authPanel, /auth\.resend[\s\S]{0,300}captchaToken: turnstileToken/);
  assert.match(authPanel, /updateUser\(\{ password \}\)/);
  assert.match(authPanel, /strongPasswordError\(password\)/);
  assert.match(authPanel, /signupErrorMessage\(result\.error\)/);
  assert.match(authPanel, /passwordExposureStatus\(password\)/);
  assert.match(authPanel, /known breach data/i);
  assert.match(authPanel, /inspectRecoveryMfa/);
  assert.match(authPanel, /verifyRecoveryMfa/);
  assert.match(authPanel, /verifyRecoveryCode/);
  assert.match(authPanel, /Recovery email code/i);
  assert.match(authPanel, /Authenticator app code/i);
  assert.match(authPanel, /recoveryMfaState === "challenge_required"/);
  assert.match(authPanel, /auth\.resend/);
  assert.match(authPanel, /scope: "global"/);
  assert.match(home, /event === "PASSWORD_RECOVERY"/);
  assert.match(home, /get\("recovery"\) === "1"/);
  assert.match(browserClient, /flowType: "pkce"/);
  assert.doesNotMatch(authPanel, /window\.location\.origin/);
  assert.doesNotMatch(home, /window\.location\.reload\(\)/);
  assert.doesNotMatch(authPanel, /window\.location\.reload\(\)/);
  assert.doesNotMatch(browserClient, /window\.location\.reload\(\)/);
  assert.match(home, /event === "SIGNED_IN"[\s\S]{0,300}loadWorkspace\(session\)/);
  assert.match(home, /entry === "load-error"/);
});

test("authentication and analytics dialogs manage keyboard focus", async () => {
  const [authPanel, analyticsConsent, modalFocus] = await Promise.all([
    readFile(new URL("../app/auth-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/google-analytics-consent.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/use-modal-focus.ts", import.meta.url), "utf8"),
  ]);

  assert.match(authPanel, /useModalFocus/);
  assert.match(authPanel, /aria-describedby="auth-description"/);
  assert.match(analyticsConsent, /useModalFocus/);
  assert.match(analyticsConsent, /aria-modal="true"/);
  assert.match(analyticsConsent, /isPublicMeasurementPage\(pathname\)[\s\S]{0,300}setAnalyticsDisabled\(false\)/);
  assert.match(modalFocus, /event\.key === "Escape"/);
  assert.match(modalFocus, /event\.key !== "Tab"/);
  assert.match(modalFocus, /sibling\.inert = true/);
  assert.match(modalFocus, /getClientRects\(\)\.length > 0/);
  assert.match(modalFocus, /!container\.contains\(document\.activeElement\)/);
  assert.match(modalFocus, /opener\?\.focus/);
});

test("the hydrated missing page cannot restore homepage metadata", async () => {
  const [notFound, metadataGuard] = await Promise.all([
    readFile(new URL("../app/not-found.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/not-found-metadata-guard.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(notFound, /<NotFoundMetadataGuard \/>/);
  assert.match(metadataGuard, /document\.title = TITLE/);
  assert.match(metadataGuard, /link\[rel="canonical"\]/);
  assert.match(metadataGuard, /openGraphUrl\?\.remove\(\)/);
  assert.match(metadataGuard, /new MutationObserver\(enforceNotFoundMetadata\)/);
});

test("signup success continues with in-place email code verification", async () => {
  const authPanel = await readFile(new URL("../app/auth-panel.tsx", import.meta.url), "utf8");

  assert.match(authPanel, /"verify-signup"/);
  assert.match(authPanel, /verifySignupCode\(supabase, email, verificationCode\)/);
  assert.match(authPanel, /Verification code/i);
  assert.doesNotMatch(authPanel, /Six-digit verification code/);
  assert.match(authPanel, /autoComplete="one-time-code"/);
  assert.match(authPanel, /auth\.resend[\s\S]{0,500}captchaToken: turnstileToken/);
  assert.match(authPanel, /authenticated\(session\)/);
  assert.doesNotMatch(authPanel, /Check your email and open the newest verification link/);
  assert.doesNotMatch(authPanel, /setSignupSubmitted\(true\)/);
});

test("authenticated accounts require Supabase TOTP and a confirmed AAL2 session", async () => {
  const source = await readFile(new URL("../app/founder-mfa-gate.tsx", import.meta.url), "utf8");
  assert.match(source, /auth\.mfa\.getAuthenticatorAssuranceLevel/);
  assert.match(source, /auth\.mfa\.listFactors/);
  assert.match(source, /auth\.mfa\.enroll/);
  assert.match(source, /auth\.mfa\.challengeAndVerify/);
  assert.match(source, /removal\.error\.status !== 404/);
  assert.match(source, /refreshedFactors\.data\.all\.some/);
  assert.match(source, /no new QR code was issued/i);
  assert.match(source, /currentLevel !== "aal2"/);
  assert.match(source, /six-digit code/i);
  assert.doesNotMatch(source, /Supabase AAL2|Server-enforced AAL2|Separate session on every device/);
  assert.doesNotMatch(source, /sessionStorage|signInWithOtp|founder_email_verified/);
});

test("Cloudflare Turnstile protects every unauthenticated Supabase email flow", async () => {
  const authPanel = await readFile(new URL("../app/auth-panel.tsx", import.meta.url), "utf8");
  const signupRoute = await readFile(new URL("../app/api/v1/auth/signup/route.ts", import.meta.url), "utf8");
  const signinRoute = await readFile(new URL("../app/api/v1/auth/signin/route.ts", import.meta.url), "utf8");

  assert.match(authPanel, /mode === "signup" \|\| mode === "signin" \|\| mode === "request-reset"/);
  assert.match(authPanel, /password-recovery/);
  assert.match(signupRoute, /SUPABASE_CAPTCHA_ENABLED/);
  const signupCall = authPanel.slice(authPanel.indexOf("const result = await supabase.auth.signUp("), authPanel.indexOf("if (result.error)"));
  assert.match(signupCall, /options: \{[\s\S]*captchaToken: turnstileToken/);
  assert.match(signinRoute, /SUPABASE_CAPTCHA_ENABLED/);
  assert.match(signinRoute, /gotrue_meta_security: \{ captcha_token: turnstileToken \}/);
  assert.match(signinRoute, /signin:account-source/);
  assert.match(signinRoute, /signin:source/);
  assert.doesNotMatch(signupRoute, /export async function POST/);
});

test("authentication callbacks use one canonical production origin", async () => {
  const authPanel = await readFile(new URL("../app/auth-panel.tsx", import.meta.url), "utf8");
  const home = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const authUrls = await readFile(new URL("../shared/auth-urls.ts", import.meta.url), "utf8");

  assert.match(authUrls, /CANONICAL_APP_ORIGIN = "https:\/\/vanteloq\.com"/);
  assert.match(authUrls, /LEGACY_APP_HOSTNAME = "vanteloq\.hussien05issa\.chatgpt\.site"/);
  assert.match(home, /canonicalLocation\(window\.location\)/);
  assert.match(home, /window\.location\.replace\(canonicalDestination\)/);
  assert.match(worker, /Response\.redirect\(destination, 308\)/);
  assert.match(authPanel, /canonicalAuthUrl\("\/"\)/);
  assert.match(authPanel, /canonicalAuthUrl\("\/\?recovery=1"\)/);
});

test("authorization is server-bound to immutable identity and Supabase AAL2", async () => {
  const authorization = await readFile(new URL("../server/authorization.ts", import.meta.url), "utf8");
  const api = await readFile(new URL("../server/api.ts", import.meta.url), "utf8");
  const internalAccess = await readFile(new URL("../server/internal-access.ts", import.meta.url), "utf8");

  assert.match(authorization, /row\.authSubject !== identity\.subject/);
  assert.match(authorization, /requireAal2\(identity\)/);
  assert.match(api, /identity\.provider !== "supabase" \|\| identity\.assuranceLevel !== "aal2"/);
  assert.match(internalAccess, /mfa_required = 1/);
  assert.doesNotMatch(internalAccess, /mfa_required[\s\S]{0,20}VALUES[\s\S]{0,80}, 0,/);
});

test("paid API access is server-enforced with narrow billing and privacy exceptions", async () => {
  const authorization = await readFile(new URL("../server/authorization.ts", import.meta.url), "utf8");
  const entitlements = await readFile(new URL("../server/entitlements/engine.ts", import.meta.url), "utf8");
  const marketingRoutes = await readFile(new URL("../server/integrations/marketing-routes.ts", import.meta.url), "utf8");

  assert.match(authorization, /const entitlements = await getTenantEntitlements\(context\);[\s\S]{0,120}requireTenantServiceAccess\(entitlements\);[\s\S]{0,120}requireFeatureEntitlement\(entitlements, requiredFeature\)/);
  assert.match(entitlements, /accessType === "none"[\s\S]{0,180}402,[\s\S]{0,80}"SUBSCRIPTION_REQUIRED"/);
  assert.match(marketingRoutes, /marketingDisconnect[\s\S]{0,300}requirePrivacyAccess\(request, \["owner", "admin"\]\)/);

  const apiRoot = new URL("../app/api/v1/", import.meta.url);
  const routePaths = (await readdir(apiRoot, { recursive: true }))
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => path.endsWith("route.ts"))
    .sort();
  const billingExceptions = [];
  const privacyExceptions = [];
  for (const path of routePaths) {
    const source = await readFile(new URL(path, apiRoot), "utf8");
    if (source.includes("requireBillingAccess")) billingExceptions.push(path);
    if (source.includes("requirePrivacyAccess")) privacyExceptions.push(path);
  }

  assert.deepEqual(billingExceptions, [
    "billing/checkout/route.ts",
    "billing/portal/route.ts",
    "billing/route.ts",
    "entitlements/route.ts",
    "session/route.ts",
  ]);
  const memberEntitlements = await readFile(new URL("entitlements/route.ts", apiRoot), "utf8");
  assert.match(memberEntitlements, /requireBillingAccess\(request,/);
  assert.match(memberEntitlements, /getTenantEntitlements\(context\)/);
  assert.doesNotMatch(memberEntitlements, /stripeCustomerId|stripeSubscriptionId|paymentMethod/);
  assert.deepEqual(privacyExceptions, [
    "account/deletion/route.ts",
    "advisor/chat/route.ts",
    "advisor/consent/route.ts",
    "advisor/conversations/route.ts",
    "integrations/clover/disconnect/route.ts",
    "integrations/lightspeed-r/disconnect/route.ts",
    "integrations/lightspeed/disconnect/route.ts",
    "integrations/moneris/disconnect/route.ts",
    "integrations/plaid/delete-data/route.ts",
    "integrations/plaid/disconnect/route.ts",
    "integrations/quickbooks/disconnect/route.ts",
    "integrations/shopify-pos/disconnect/route.ts",
    "integrations/square/disconnect/route.ts",
    "integrations/stripe/disconnect/route.ts",
    "legal/acceptance/route.ts",
  ]);

  for (const path of ["integrations/plaid/delete-data/route.ts", "integrations/plaid/disconnect/route.ts"]) {
    const source = await readFile(new URL(path, apiRoot), "utf8");
    assert.doesNotMatch(source, /requireAddon\(/, path);
  }
  for (const path of ["reports/route.ts", "growth/route.ts", "tasks/route.ts"]) {
    const source = await readFile(new URL(path, apiRoot), "utf8");
    assert.match(source, /requireAccess\(request,/, path);
    assert.doesNotMatch(source, /requireBillingAccess|requirePrivacyAccess/, path);
  }
});

test("critical product surfaces preserve the readability and focus floor", async () => {
  const stylesheet = await readFile(new URL("../app/readability.css", import.meta.url), "utf8");

  assert.match(stylesheet, /\.operating-shell :is\(p, label, dt, dd\)/);
  assert.match(stylesheet, /font-size: max\(13px, 1em\) !important/);
  assert.match(stylesheet, /:focus-visible/);
  assert.match(stylesheet, /outline: 3px solid/);
  assert.match(stylesheet, /prefers-reduced-motion: reduce/);
  assert.match(stylesheet, /\.auth-panel input \{ min-height: 46px; font-size: 16px/);
  assert.match(stylesheet, /\.founder-mfa-copy p,[\s\S]*font-size: 16px/);
});

test("the authenticated shell switches to tablet navigation without a sidebar overlap", async () => {
  const [globals, design] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/design-v2.css", import.meta.url), "utf8"),
  ]);

  assert.match(globals, /@media\(max-width:900px\)\{\.app-shell\{display:block\}/);
  assert.match(globals, /@media\(max-width:900px\)\{\.sidebar\{position:fixed;left:-100%/);
  assert.match(design, /@media \(max-width: 900px\) \{[\s\S]*?\.operating-shell \.sidebar/);
});

test("the worker enforces the complete content security policy", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

  assert.match(source, /headers\.set\(\s*"Content-Security-Policy"/);
  assert.match(source, /https:\/\/api\.pwnedpasswords\.com/);
  assert.match(source, /frame-ancestors 'none'/);
  assert.match(source, /object-src 'none'/);
  assert.match(source, /https:\/\/challenges\.cloudflare\.com/);
  assert.match(source, /upgrade-insecure-requests/);
  assert.match(source, /headers\.delete\("Content-Security-Policy-Report-Only"\)/);
});
