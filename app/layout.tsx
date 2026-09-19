import type { Metadata } from "next";
import { GoogleAnalyticsConsent } from "./google-analytics-consent";
import { DEFAULT_SOCIAL_IMAGE, organizationJsonLd, safeJsonLd, SITE_ORIGIN } from "./seo";
import "./globals.css";
import "./operating.css";
import "./bookloq.css";
import "./governance.css";
import "./billing.css";
import "./control.css";
import "./theme.css";
import "./brand.css";
import "./design-v2.css";
import "./homepage.css";
import "./legal.css";
import "./readability.css";
import "./analytics-consent.css";
import "./experience.css";

import "./workspace-design.css";
import "./marketing-reporting.css";
import "./marketing-workbench.css";
import "./vanteloq-ai-brand.css";
import "./typography.css";
import "./product-demo.css";
import "./retail-intelligence.css";
import "./customer-journey.css";
import "./launch.css";
import "./launch-polish.css";
import "./ai-orbit-showcase.css";
import "./journey-refinement.css";
import "./decision-workspace.css";
import "./interface-polish.css";
import "./reference-theme.css";
import "./custom-plan-callout.css";
import "./finance-chart.css";
import "./integrations-theme.css";
import "./bookloq-discovery.css";
import "./bookloq-statement-import.css";
import "./bookloq-dashboard-visuals.css";
import "./marketing-consent.css";
import "./document-workspace-polish.css";
import "./dashboard-release-polish.css";
import "./commerce-visuals.css";
import "./dashboard-explorer.css";
import "./bookloq-display.css";
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
  title: "Vanteloq | Business Analytics for Independent Retail",
  description: "Inspect sales, stock and cash with the records behind the numbers. Built for independent retail, with BookLoQ accounting and Vanteloq AI. Try the demo without signup.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Vanteloq",
    title: "Vanteloq | Business Analytics for Independent Retail",
    description: "Sales, stock and cash, with the records behind the numbers. Explore Vanteloq for independent retail.",
    images: [{ url: DEFAULT_SOCIAL_IMAGE, width: 1487, height: 1058, alt: "Vanteloq business operating view" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vanteloq | Business Analytics for Independent Retail",
    description: "Sales, stock and cash, with the records behind the numbers. Explore Vanteloq for independent retail.",
    images: [DEFAULT_SOCIAL_IMAGE],
  },
  icons: {
    icon: { url: "/brand/vanteloq-mark.png", type: "image/png" },
    shortcut: "/brand/vanteloq-mark.png",
    apple: "/brand/vanteloq-mark.png",
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
      </head>
      <body className="antialiased">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(organizationJsonLd) }} />
        {children}
        <GoogleAnalyticsConsent />
      </body>
    </html>
  );
}
