import { CANONICAL_APP_ORIGIN } from "../shared/auth-urls";
import { SOCIAL_PROFILES } from "./social-profiles";

export const SITE_NAME = "Vanteloq";
export const SITE_ORIGIN = CANONICAL_APP_ORIGIN;
export const DEFAULT_SOCIAL_IMAGE = "/brand/glass-2026-10-12/vanteloq.jpg";

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
  legalName: "Vanteloq Inc.",
  alternateName: "Vanteloq",
  url: SITE_ORIGIN,
  email: "support@vanteloq.com",
  sameAs: Object.values(SOCIAL_PROFILES).map((profile) => profile.href),
  logo: absoluteUrl("/brand/glass-2026-10-12/vanteloq.jpg"),
  description:
    "Vanteloq is a product of Vanteloq Inc. It connects business source records with operating workflows, financial review and reporting.",
};
