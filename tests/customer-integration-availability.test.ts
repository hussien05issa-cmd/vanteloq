import assert from "node:assert/strict";
import test from "node:test";
import { customerIntegrationAvailability, hasConnectionAttention, PREVIEW_INTEGRATION_IDS } from "../domain/integration-availability.ts";
import { aggregateConnectionStatus } from "../domain/integration-source.ts";
import { connectorNextStep } from "../domain/connector-guidance.ts";
import { documentPipelineLabel } from "../domain/document-pipeline-labels.ts";
import { integrationCatalog, integrationPublicStatus } from "../app/integration-catalog.ts";

const readiness = { credentialsConfigured: true, mode: "production", liveDataEligible: true };
const provider = (id: string) => ({ id, availability: "credentials_required", providerReadiness: readiness });

test("a healthy account cannot hide a failed sibling behind a connected provider summary", () => {
  const healthy = { status: "connected", lastErrorCode: null, dataPromotionStatus: "approved", lastSuccessfulSyncAt: "2026-09-16T12:00:00Z" };
  const failed = { ...healthy, status: "error", lastErrorCode: null };
  const connections = [healthy, failed], aggregate = aggregateConnectionStatus(connections);
  assert.equal(aggregate.status, "connected");
  assert.equal(hasConnectionAttention({ ...aggregate, connections }), true);
  assert.equal(hasConnectionAttention({ ...aggregateConnectionStatus([healthy]), connections: [healthy] }), false);
  assert.equal(hasConnectionAttention({ ...aggregate, connections: [healthy, { ...healthy, lastErrorCode: "SYNC_FAILED" }] }), true);
});

test("saved credentials alone never offer unfinished providers to ordinary subscribers", () => {
  for (const id of PREVIEW_INTEGRATION_IDS) {
    assert.deepEqual(customerIntegrationAvailability(provider(id)), { comingSoon: true, canStartConnection: false, previewAccess: false });
    assert.deepEqual(customerIntegrationAvailability(provider(id), true), { comingSoon: true, canStartConnection: true, previewAccess: true });
  }
  assert.equal(customerIntegrationAvailability({ ...provider("quickbooks"), providerReadiness: { ...readiness, credentialsConfigured: false } }, true).canStartConnection, false);
  assert.equal(customerIntegrationAvailability({ ...provider("xero"), availability: "provider_build_required" }, true).canStartConnection, false);
});

test("working providers retain connection access and missing configuration never pretends to be ready", () => {
  for (const id of ["lightspeed-r", "lightspeed", "square", "stripe", "google"]) {
    assert.deepEqual(customerIntegrationAvailability(provider(id)), { comingSoon: false, canStartConnection: true, previewAccess: false });
    assert.equal(customerIntegrationAvailability({ ...provider(id), providerReadiness: null }).canStartConnection, false);
  }
});

test("Plaid follows real production eligibility, not merely configured credentials", () => {
  for (const mode of ["sandbox", "development", "unconfigured"]) assert.equal(customerIntegrationAvailability({ ...provider("plaid"), providerReadiness: { ...readiness, mode } }).canStartConnection, false);
  assert.equal(customerIntegrationAvailability({ ...provider("plaid"), providerReadiness: { ...readiness, liveDataEligible: false } }).canStartConnection, false);
  assert.equal(customerIntegrationAvailability(provider("plaid")).canStartConnection, true);
});

test("existing failures and test-data warnings remain visible despite Coming Soon public availability", () => {
  const saved = { ...provider("clover"), name: "Clover", category: "Point of sale", status: "error", dataPromotionStatus: "staging", lastSuccessfulSyncAt: null };
  assert.equal(connectorNextStep(saved, true, true).stage, "Repair connection");
  assert.equal(connectorNextStep({ ...saved, status: "connected", providerReadiness: { ...readiness, mode: "sandbox" } }, true, true).stage, "Test data only");
  assert.equal(connectorNextStep({ ...saved, status: "not_connected" }, false, false).stage, "Coming Soon", "do not upsell a plan for an unfinished provider");
});

test("public cards use simple availability and keep implementation details out of introductory copy", () => {
  for (const item of integrationCatalog) {
    const status = integrationPublicStatus(item);
    assert.ok(["Available", "Coming Soon"].includes(status.label));
    assert.doesNotMatch(item.activationRequirement, /tenant|staging|adapter|client secret|hosted credentials|oauth|ledger import|production review/i);
  }
});

test("document services use readable customer labels and preserve unavailable and device-dependent states", () => {
  assert.deepEqual(documentPipelineLabel("tenantStorage", "live"), { label: "Private File Storage", status: "Available" });
  assert.deepEqual(documentPipelineLabel("ocrExtraction", "configured"), { label: "Read Document Text", status: "Available" });
  assert.equal(documentPipelineLabel("malwareScanning", "not_configured").status, "Coming Soon");
  assert.equal(documentPipelineLabel("cameraCapture", "browser_supported").status, "On Supported Devices");
  assert.equal(documentPipelineLabel("unexpectedInternalName", "unexpected").status, "Check Status");
});
