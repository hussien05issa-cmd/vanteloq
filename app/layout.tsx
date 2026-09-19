import type { Metadata } from "next";
import { GoogleAnalyticsConsent } from "./google-analytics-consent";
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
