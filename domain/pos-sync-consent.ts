import { PRIVACY_POLICY_VERSION } from "../shared/legal-versions";

export const POS_SYNC_CONSENT_VERSION = "pos-background-data-v1";
export function posSyncDataCategories(provider: string) {
  return provider === "stripe" || provider === "moneris"
    ? ["Authorized account and connection identifiers", "Payment amounts, statuses, dates and reconciliation references"]
    : ["Authorized account and outlet identifiers", "Sales, returns, discounts and payment totals", "Products, categories, stock levels and available costs", "Customer identifiers and permitted customer directory fields", "Supplier identifiers and directory fields"];
}
export const POS_SYNC_PURPOSES = ["Continue authorized read-only imports while the browser is closed", "Refresh approved business reports and retain import audit evidence"];

export type BackgroundSyncConsent = {
  organizationId: string;
  actorUserId: string | null;
  provider: string;
  status: string;
  noticeVersion: string;
  privacyPolicyVersion: string;
  dataCategoriesJson: string;
  purposesJson: string;
  acceptedAt: number | null;
  withdrawnAt: number | null;
};

// A connection acknowledgement does not authorize work while the browser is closed.
// Consent lasts until withdrawal or a notice, policy, owner or access change, rather
// than acquiring an arbitrary elapsed-time expiry that was never disclosed.
export function isCurrentBackgroundSyncConsent(
  consent: BackgroundSyncConsent | null,
  scope: { organizationId: string; actorUserId: string; provider: string },
  now = Math.floor(Date.now() / 1000),
): boolean {
  return !!consent && consent.organizationId === scope.organizationId && consent.actorUserId === scope.actorUserId
    && consent.provider === scope.provider && consent.status === "accepted"
    && consent.noticeVersion === POS_SYNC_CONSENT_VERSION && consent.privacyPolicyVersion === PRIVACY_POLICY_VERSION
    && consent.dataCategoriesJson === JSON.stringify(posSyncDataCategories(scope.provider))
    && consent.purposesJson === JSON.stringify(POS_SYNC_PURPOSES)
    && Number.isSafeInteger(consent.acceptedAt) && consent.acceptedAt! > 0 && consent.acceptedAt! <= now + 90
    && consent.withdrawnAt === null;
}
