import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_IMPORT_PRIVACY_VERSION, importPrivacyAcknowledgement, appendImportPrivacyAcknowledgement } from "../domain/report-import-privacy";
import { requireReportImportPrivacyAcknowledgement, requireMultipartImportPrivacyAcknowledgement, reportImportPrivacyAuditDetails } from "../server/report-import-privacy";
import { ApiError } from "../server/api";

test("report imports require affirmative current acknowledgement with no extra contents", () => {
  for (const value of [undefined, null, false, [], "true", {}, { version: REPORT_IMPORT_PRIVACY_VERSION, accepted: false },
    { version: REPORT_IMPORT_PRIVACY_VERSION, accepted: "true" }, { ...importPrivacyAcknowledgement(), document: "excluded" }]) {
    assert.throws(() => requireReportImportPrivacyAcknowledgement(value), (error: unknown) => error instanceof ApiError && error.status === 400 && error.code === "REPORT_IMPORT_PRIVACY_REQUIRED");
  }
  for (const version of [undefined, "old-notice", "", 1]) {
    assert.throws(() => requireReportImportPrivacyAcknowledgement({ version, accepted: true }), (error: unknown) => error instanceof ApiError && error.status === 409 && error.code === "REPORT_IMPORT_PRIVACY_STALE");
  }
  const accepted = requireReportImportPrivacyAcknowledgement(importPrivacyAcknowledgement());
  assert.deepEqual(reportImportPrivacyAuditDetails(accepted), { importPrivacyVersion: REPORT_IMPORT_PRIVACY_VERSION, importPrivacyAccepted: true });
});

test("multipart uploads require exactly one current affirmative acknowledgement", () => {
  const form = new FormData();
  assert.throws(() => requireMultipartImportPrivacyAcknowledgement(form), /Review and accept/);
  appendImportPrivacyAcknowledgement(form);
  assert.deepEqual(requireMultipartImportPrivacyAcknowledgement(form), importPrivacyAcknowledgement());
  form.set("importPrivacyAccepted", "TRUE");
  assert.throws(() => requireMultipartImportPrivacyAcknowledgement(form), /Review and accept/);
  appendImportPrivacyAcknowledgement(form);
  form.append("importPrivacyAccepted", "true");
  assert.throws(() => requireMultipartImportPrivacyAcknowledgement(form), /Review and accept/);
  appendImportPrivacyAcknowledgement(form);
  form.set("importPrivacyVersion", "old-notice");
  assert.throws(() => requireMultipartImportPrivacyAcknowledgement(form), /notice changed/);
  appendImportPrivacyAcknowledgement(form);
  form.append("importPrivacyVersion", REPORT_IMPORT_PRIVACY_VERSION);
  assert.throws(() => requireMultipartImportPrivacyAcknowledgement(form), /Review and accept/);
});
