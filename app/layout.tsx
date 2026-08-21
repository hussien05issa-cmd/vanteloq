import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
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
import "./lexedge.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: "Lexedge Consulting | Make your next move matter",
  description: "Lexedge Consulting helps ambitious businesses sharpen positioning, improve conversion and build growth systems that scale.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Lexedge Consulting",
    title: "Lexedge Consulting | Make your next move matter",
    description: "Premium growth strategy, conversion and operating systems for businesses ready for their next edge.",
    images: [{ url: "/brand/lexedge-logo.png", width: 1536, height: 1024, alt: "Lexedge Consulting" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Lexedge Consulting | Make your next move matter",
    description: "Premium growth strategy, conversion and operating systems for businesses ready for their next edge.",
    images: ["/brand/lexedge-logo.png"],
  },
  icons: {
    icon: { url: "/brand/lexedge-logo.png", type: "image/png" },
    shortcut: "/brand/lexedge-logo.png",
    apple: "/brand/lexedge-logo.png",
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
