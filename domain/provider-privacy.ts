export const PROVIDER_PRIVACY_NOTICE_VERSION = "provider-privacy-2026-09-26";
export const providerPrivacy = {
  square: { name: "Square", url: "https://squareup.com/ca/en/legal/general/privacy" },
  stripe: { name: "Stripe", url: "https://stripe.com/privacy" },
  lightspeed: { name: "Lightspeed", url: "https://www.lightspeedhq.com/legal/privacy-policy/" },
  "lightspeed-r": { name: "Lightspeed", url: "https://www.lightspeedhq.com/legal/privacy-policy/" },
  clover: { name: "Clover", url: "https://www.clover.com/ca/privacy-policy" },
  shopify: { name: "Shopify", url: "https://www.shopify.com/legal/privacy" },
  "shopify-pos": { name: "Shopify", url: "https://www.shopify.com/legal/privacy" },
  google: { name: "Google", url: "https://policies.google.com/privacy" },
  meta: { name: "Meta", url: "https://www.facebook.com/privacy/policy/" },
  slack: { name: "Slack", url: "https://slack.com/trust/privacy/privacy-policy" },
  plaid: { name: "Plaid", url: "https://plaid.com/legal/#end-user-privacy-policy" },
  quickbooks: { name: "Intuit", url: "https://www.intuit.com/privacy/statement/" },
  deel: { name: "Deel", url: "https://www.deel.com/legal/privacy-policy/" },
  moneris: { name: "Moneris", url: "https://www.moneris.com/en/legal/privacy-statement" },
} as const;
export type PrivacyProvider = keyof typeof providerPrivacy;
export function providerPrivacyAcceptance(accepted: boolean) {
  return { providerPrivacyAccepted: accepted, providerPrivacyNoticeVersion: PROVIDER_PRIVACY_NOTICE_VERSION };
}
export function privacyProvider(value: string): PrivacyProvider | null { return Object.hasOwn(providerPrivacy, value) ? value as PrivacyProvider : null; }
export function validProviderPrivacyAcceptance(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return input.providerPrivacyAccepted === true && input.providerPrivacyNoticeVersion === PROVIDER_PRIVACY_NOTICE_VERSION;
}
