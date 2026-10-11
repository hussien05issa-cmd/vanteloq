/** Change this version when the report import purposes or material disclosures change. */
export const REPORT_IMPORT_PRIVACY_VERSION = "report-import-privacy-2026-10-10";

export type ReportImportPrivacyAcknowledgement = {
  version: typeof REPORT_IMPORT_PRIVACY_VERSION;
  accepted: true;
};

/** Serialize only after the user affirmatively accepts the current upload notice. */
export function importPrivacyAcknowledgement(): ReportImportPrivacyAcknowledgement {
  return { version: REPORT_IMPORT_PRIVACY_VERSION, accepted: true };
}

/** Serialize only after the user affirmatively accepts the current upload notice. */
export function appendImportPrivacyAcknowledgement(formData: FormData): void {
  formData.set("importPrivacyVersion", REPORT_IMPORT_PRIVACY_VERSION);
  formData.set("importPrivacyAccepted", "true");
}
