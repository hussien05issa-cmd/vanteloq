import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BookloqPayrollSourcePanel from "../app/bookloq-payroll-source";
import type { BookloqPayrollSource } from "../domain/bookloq-payroll-source";

const source: BookloqPayrollSource = {
  provider: "deel", status: "staged", configuredEnvironment: "sandbox", recordEnvironment: "unverified",
  connections: [{ id: "fictional", accountName: "Fictional payroll account", status: "connected", promotionStatus: "staging", lastSuccessfulSyncAt: 1791547200, mappedLocationCount: 1, reportCount: 2, latestReportPeriod: { start: "2026-09-01", end: "2026-09-30" }, lastImportedAt: 1791547200, reviewReasons: ["Approval and payment remain unverified."] }],
  boundary: "Source reports do not create journal entries or payments.",
};
test("restricted payroll metadata is never exposed", () => {
  assert.equal(renderToStaticMarkup(<BookloqPayrollSourcePanel source={{ ...source, status: "restricted" }} openIntegrations={() => {}} />), "");
});
test("connected staged reports show a review path without claiming payroll was paid or posted", () => {
  const html = renderToStaticMarkup(<BookloqPayrollSourcePanel source={source} openIntegrations={() => {}} />);
  assert.match(html, /Fictional payroll account/);
  assert.match(html, /2026-09-01 to 2026-09-30/);
  assert.match(html, /2 staged aggregate records/);
  assert.match(html, /Report environment: unverified/);
  assert.match(html, /UTC/);
  assert.match(html, /Review payroll connection/);
  assert.doesNotMatch(html, /No connected Deel source|<form|CAD|USD|Source verified/);
});
