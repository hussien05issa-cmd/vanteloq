import { CANONICAL_APP_ORIGIN } from "../shared/auth-urls";

export const SITE_NAME = "Vanteloq";
export const SITE_ORIGIN = CANONICAL_APP_ORIGIN;
export const DEFAULT_SOCIAL_IMAGE = "/brand/vanteloq-command-ledger.png";

export function absoluteUrl(path = "/") {
  return new URL(path, `${SITE_ORIGIN}/`).toString();
}

export function safeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE_ORIGIN}/#organization`,
  name: SITE_NAME,
  url: SITE_ORIGIN,
  logo: absoluteUrl("/brand/vanteloq-logo.png"),
  description:
    "Vanteloq is a source-aware business operations and analytics platform for independent retail.",
};
