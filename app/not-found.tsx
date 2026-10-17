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
      <p>Let’s get you back</p>
      <h1>We couldn’t find this page.</h1>
      <span>The link may have changed. Check the address or return to Vanteloq.</span>
      <div><Link href="/">Return home</Link><Link href="/resources">Browse resources</Link></div>
    </main>
  );
}
