import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildDeelAuthorizationUrl, DEEL_API_VERSION, DEEL_READ_SCOPES, deelMoneyToCents,
  deelReadiness, exchangeDeelCode, fetchDeelGrossToNetSummaryWithToken,
  fetchFinalizedDeelPayrollCyclesWithToken, refreshDeelToken,
} from "../server/integrations/deel.ts";

(globalThis as typeof globalThis & { __vanteloqEnv?: Record<string, string> }).__vanteloqEnv = {
  DEEL_CLIENT_ID: "deel-test-client",
  DEEL_CLIENT_SECRET: "deel-test-secret",
  DEEL_REDIRECT_URI: "https://vanteloq.com/api/v1/integrations/deel/callback",
  DEEL_ENV: "sandbox",
  INTEGRATION_ENCRYPTION_KEY: Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString("base64"),
};

test("Deel readiness and authorization stay read only, staged, and Coming Soon", () => {
  const readiness = deelReadiness();
  assert.equal(readiness.credentialsConfigured, true);
  assert.equal(readiness.environment, "sandbox");
  assert.equal(readiness.productionApproved, true);
  assert.equal(readiness.publicAvailability, "coming_soon");
  assert.equal(readiness.dataPromotionEnabled, false);
  assert.equal(readiness.employeeRecordsStored, false);
  assert.deepEqual(readiness.scopes, [...DEEL_READ_SCOPES]);
  assert.equal(readiness.scopes.some((scope) => scope.endsWith(":write") || scope.includes("people") || scope.includes("bank")), false);
  const url = new URL(buildDeelAuthorizationUrl("a".repeat(43)));
  assert.equal(url.origin, "https://app-sandbox.letsdeel.com");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("scope"), DEEL_READ_SCOPES.join(" "));
  assert.doesNotMatch(url.toString(), /deel-test-secret/);
});

test("Deel token exchange uses Basic authentication and replaces the single-use refresh token", async () => {
  const requests: { url: string; authorization: string | null; body: Record<string, string> }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input), authorization: new Headers(init?.headers).get("authorization"),
      body: Object.fromEntries(new URLSearchParams(String(init?.body))),
    });
    return Response.json({
      access_token: `access-${requests.length}`, refresh_token: `refresh-${requests.length}`,
      token_type: "Bearer", expires_in: 2_592_000, scope: DEEL_READ_SCOPES.join(" "),
    });
  }) as typeof fetch;
  const first = await exchangeDeelCode("authorization-code", fetcher);
  const refreshed = await refreshDeelToken(first.refreshToken, fetcher);
  assert.equal(first.refreshToken, "refresh-1");
  assert.equal(refreshed.refreshToken, "refresh-2");
  assert.equal(requests[0].url, "https://app-sandbox.letsdeel.com/oauth/token");
  assert.match(requests[0].authorization ?? "", /^Basic /);
  assert.deepEqual(requests.map((request) => request.body.grant_type), ["authorization_code", "refresh_token"]);
  assert.equal(requests[1].body.refresh_token, "refresh-1");
});

test("Deel payroll cycles include only provider-published gross-to-net evidence", async () => {
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer access-token");
    assert.equal(headers.get("x-client-id"), "deel-test-client");
    assert.equal(headers.get("x-version"), DEEL_API_VERSION);
    return Response.json({ data: [
      { id: "11111111-1111-4111-8111-111111111111", type: "REGULAR", date_start: "2026-08-01T00:00:00Z", date_end: "2026-08-31T00:00:00Z", has_g2n_report: true, legal_entity_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", payroll_group_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { id: "22222222-2222-4222-8222-222222222222", type: "REGULAR", date_start: "2026-09-01T00:00:00Z", date_end: "2026-09-30T00:00:00Z", has_g2n_report: false, legal_entity_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    ], has_more: false, next_cursor: null });
  }) as typeof fetch;
  const cycles = await fetchFinalizedDeelPayrollCyclesWithToken("access-token", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "2026-08-01", "2026-09-30", fetcher);
  assert.deepEqual(cycles.map((cycle) => cycle.id), ["11111111-1111-4111-8111-111111111111"]);
});

test("Deel gross-to-net normalization emits currency totals and discards all worker-level fields", async () => {
  const fetcher = (async () => Response.json({
    data: [{
      contract_oid: "worker-secret-id", currency: "CAD",
      payment_data: { payment_currency: "CAD", conversion_rate: "1" },
      items: [
        { label: "Private base pay", category: "Gross", sub_category: "Salary", category_group: "ADDITIONS", value: 1000.25 },
        { label: "Private tax", category: "Tax", sub_category: "Income tax", category_group: "DEDUCTIONS", value: -200.1 },
      ],
    }], has_more: false, next_cursor: null,
    created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-01T11:00:00Z",
  })) as typeof fetch;
  const summary = await fetchDeelGrossToNetSummaryWithToken("access-token", "11111111-1111-4111-8111-111111111111", fetcher);
  assert.equal(summary[0].currency, "CAD");
  assert.equal(summary[0].categoryTotalsCents.ADDITIONS, 100025);
  assert.equal(summary[0].categoryTotalsCents.DEDUCTIONS, -20010);
  assert.doesNotMatch(JSON.stringify(summary), /worker-secret-id|Private base pay|Salary|payment_currency/);
});

test("Deel money conversion refuses silent rounding and scientific notation", () => {
  assert.equal(deelMoneyToCents("1000.25"), 100025);
  assert.equal(deelMoneyToCents(-20.1), -2010);
  assert.throws(() => deelMoneyToCents("1.005"), /without rounding/);
  assert.throws(() => deelMoneyToCents(1e21), /without rounding/);
});

test("Deel routes enforce consent, privacy, role, staging and deletion boundaries", () => {
  const authorize = readFileSync(`${process.cwd()}/app/api/v1/integrations/deel/authorize/route.ts`, "utf8");
  const sync = readFileSync(`${process.cwd()}/server/integrations/sync/deel.ts`, "utf8");
  const disconnect = readFileSync(`${process.cwd()}/app/api/v1/integrations/deel/disconnect/route.ts`, "utf8");
  assert.match(authorize, /confirmedAggregatePayrollOnly/);
  assert.match(authorize, /requireIntegrationRollout/);
  assert.match(authorize, /payroll\.totals/);
  assert.match(sync, /dataPromotionStatus: "staging"/);
  assert.match(sync, /wagesCents: null/);
  assert.match(sync, /paidMinutes: null/);
  assert.doesNotMatch(sync, /contract_oid|payment_data|employeeName|bankAccount|payslip/);
  assert.match(disconnect, /delete\(retailMeasurements\)/);
  assert.match(disconnect, /providerRevocationSupported: false/);
});
