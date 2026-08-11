import type { Metadata } from "next";
import { DEFAULT_SOCIAL_IMAGE, organizationJsonLd, safeJsonLd, SITE_ORIGIN } from "./seo";
import "./globals.css";
import "./operating.css";
import "./bookloq.css";
import "./governance.css";
import "./billing.css";
import "./control.css";
import "./theme.css";
import "./readability.css";
import "./brand.css";
import "./design-v2.css";
import "./homepage.css";
import "./legal.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: "Vanteloq | Business Analytics for Independent Retail",
  description: "Bring verified sales, inventory, cash and operational records into clearer views with Vanteloq, a source-aware platform for independent retail.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Vanteloq",
    title: "Vanteloq | Business Analytics for Independent Retail",
    description: "Bring verified sales, inventory, cash and operational records into clearer views for independent retail.",
    images: [{ url: DEFAULT_SOCIAL_IMAGE, width: 1487, height: 1058, alt: "Vanteloq business operating view" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vanteloq | Business Analytics for Independent Retail",
    description: "Bring verified sales, inventory, cash and operational records into clearer views for independent retail.",
    images: [DEFAULT_SOCIAL_IMAGE],
  },
  other: {
    "codex-preview": "development",
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
      <body className="antialiased">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(organizationJsonLd) }} />
        {children}
      </body>
    </html>
  );
}
