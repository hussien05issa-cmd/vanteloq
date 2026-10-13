import type { Metadata } from "next";
import InterfaceMotion from "./interface-motion";
import { GoogleAnalyticsConsent } from "./google-analytics-consent";
import { CONSENT_PRESENTATION_BOOTSTRAP } from "./analytics-consent-navigation";
import { DEFAULT_SOCIAL_IMAGE, organizationJsonLd, safeJsonLd, SITE_ORIGIN } from "./seo";
import "./globals.css?public-surface";
import "./operating.css?public-surface";
import "./bookloq.css?public-surface";
import "./governance.css?public-surface";
import "./billing.css?public-surface";
import "./control.css?public-surface";
import "./theme.css?public-surface";
import "./brand.css?public-surface";
import "./design-v2.css?public-surface";
import "./homepage.css?public-surface";
import "./legal.css?public-surface";
import "./readability.css?public-surface";
import "./analytics-consent.css?public-surface";
import "./experience.css?public-surface";

import "./workspace-design.css?public-surface";
import "./vanteloq-ai-brand.css?public-surface";
import "./typography.css?public-surface";
import "./product-demo.css?public-surface";
import "./retail-intelligence.css?public-surface";
import "./customer-journey.css?public-surface";
import "./launch.css?public-surface";
import "./launch-polish.css?public-surface";
import "./ai-orbit-showcase.css?public-surface";
import "./journey-refinement.css?public-surface";
import "./decision-workspace.css?public-surface";
import "./interface-polish.css?public-surface";
import "./reference-theme.css?public-surface";
import "./custom-plan-callout.css?public-surface";
import "./finance-chart.css?public-surface";
import "./bookloq-discovery.css?public-surface";
import "./bookloq-dashboard-visuals.css?public-surface";
import "./marketing-consent.css?public-surface";
import "./commerce-visuals.css?public-surface";
import "./dashboard-explorer.css?public-surface";
import "./workspace-density.css?public-surface";
import "./interface-motion.css";
import "./readability-refinement.css";
import "./advisor-appearance.css";
import "./premium-tokens.css";
import "./premium-auth.css";
import "./premium-workspace.css";
import "./demo-booking.css";
import "./public-header-polish.css";
import "./public-jetblack.css";
import "./homepage-faq-polish.css";
const GOOGLE_ANALYTICS_CONSENT_DEFAULT = `
window.dataLayer = window.dataLayer || [];
window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
window.gtag("consent", "default", {
  analytics_storage: "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  wait_for_update: 500
});`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: "Vanteloq | Sales, Inventory and Cash Flow Analytics",
  description: "Trace sales, inventory and cash to source records. Bring your business into one clear view with BookLoQ and Vanteloq Data Studio. Explore the free demo.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Vanteloq",
    title: "Vanteloq | Sales, Inventory and Cash Flow Analytics",
    description: "Sales, stock and cash, with the records behind the numbers. Explore Vanteloq, BookLoQ and the new Data Studio.",
    images: [{ url: DEFAULT_SOCIAL_IMAGE, width: 1487, height: 1058, alt: "Vanteloq business operating view" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vanteloq | Sales, Inventory and Cash Flow Analytics",
    description: "Sales, stock and cash, with the records behind the numbers. Explore Vanteloq, BookLoQ and the new Data Studio.",
    images: [DEFAULT_SOCIAL_IMAGE],
  },
  icons: {
    icon: { url: "/brand/origin-metal-2026/favicon.svg", type: "image/svg+xml" },
    shortcut: "/brand/origin-metal-2026/favicon.svg",
    apple: "/brand/origin-metal-2026/vanteloq.jpg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/geist-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <script id="vanteloq-google-consent-default" dangerouslySetInnerHTML={{ __html: GOOGLE_ANALYTICS_CONSENT_DEFAULT }} />
        <script id="vanteloq-consent-presentation" dangerouslySetInnerHTML={{ __html: CONSENT_PRESENTATION_BOOTSTRAP }} />
      </head>
      <body className="antialiased">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(organizationJsonLd) }} />
        {children}
        <GoogleAnalyticsConsent />
        <InterfaceMotion />
      </body>
    </html>
  );
}
