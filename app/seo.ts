import { CANONICAL_APP_ORIGIN } from "../shared/auth-urls";
import { SOCIAL_PROFILES } from "./social-profiles";

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
  legalName: "2855706 ALBERTA INC",
  alternateName: "LexEdge Consulting",
  url: SITE_ORIGIN,
  email: "support@vanteloq.com",
  sameAs: Object.values(SOCIAL_PROFILES).map((profile) => profile.href),
  logo: absoluteUrl("/brand/origin-metal-2026/vanteloq.jpg"),
  description:
    "Vanteloq is operated by 2855706 ALBERTA INC, doing business as LexEdge Consulting. It connects source records with operating workflows for retail shops, dealerships, cafés and restaurants.",
};
