import { REPORT_IMPORT_PRIVACY_VERSION, type ReportImportPrivacyAcknowledgement } from "../domain/report-import-privacy";
import { ApiError } from "./api";

export function requireReportImportPrivacyAcknowledgement(value: unknown): ReportImportPrivacyAcknowledgement {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "REPORT_IMPORT_PRIVACY_REQUIRED", "Review and accept the upload and data-use notice before importing records.");
  }
  const acknowledgement = value as Record<string, unknown>;
  if (Object.keys(acknowledgement).some(key => key !== "version" && key !== "accepted") || acknowledgement.accepted !== true) {
    throw new ApiError(400, "REPORT_IMPORT_PRIVACY_REQUIRED", "Review and accept the upload and data-use notice before importing records.");
  }
  if (acknowledgement.version !== REPORT_IMPORT_PRIVACY_VERSION) {
    throw new ApiError(409, "REPORT_IMPORT_PRIVACY_STALE", "The upload and data-use notice changed. Review it again before importing records.");
  }
  return { version: REPORT_IMPORT_PRIVACY_VERSION, accepted: true };
}

export function requireMultipartImportPrivacyAcknowledgement(form: FormData): ReportImportPrivacyAcknowledgement {
  if (form.getAll("importPrivacyVersion").length !== 1 || form.getAll("importPrivacyAccepted").length !== 1) {
    throw new ApiError(400, "REPORT_IMPORT_PRIVACY_REQUIRED", "Review and accept the upload and data-use notice before uploading a document.");
  }
  return requireReportImportPrivacyAcknowledgement({ version: form.get("importPrivacyVersion"), accepted: form.get("importPrivacyAccepted") === "true" });
}

/** Existing audit columns persist the current actor, organization and acceptance time. */
export function reportImportPrivacyAuditDetails(acknowledgement: ReportImportPrivacyAcknowledgement) {
  return { importPrivacyVersion: acknowledgement.version, importPrivacyAccepted: true };
}
