import type { Metadata } from "next";
import Link from "next/link";
import NotFoundMetadataGuard from "./not-found-metadata-guard";
import ProductBrandLogo from "./product-brand-logo";

export const metadata: Metadata = {
  title: "Page not found | Vanteloq",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main className="site-not-found">
      <NotFoundMetadataGuard />
      <ProductBrandLogo product="vanteloq" priority />
      <p>404</p>
      <h1>This page is not in the operating view.</h1>
      <span>The link may be outdated, or the page may have moved.</span>
      <div><Link href="/">Return home</Link><Link href="/resources">Browse resources</Link></div>
    </main>
  );
}
