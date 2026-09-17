"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import ProductBrandLogo from "./product-brand-logo";
export default function PublicPageNav() {
  const path = usePathname();
  return <header className="demo-page-nav unified-public-nav"><Link href="/" aria-label="Vanteloq home"><ProductBrandLogo product="vanteloq"/><strong>Vanteloq</strong></Link><nav aria-label="Public navigation"><Link href="/demo" aria-current={path === "/demo" ? "page" : undefined}>Open the demo</Link><Link href="/#connections">Connections</Link><Link href="/pricing" aria-current={path === "/pricing" ? "page" : undefined}>Pricing</Link><Link href="/help" aria-current={path === "/help" ? "page" : undefined}>Help</Link><Link href="/?start=signin">Sign in</Link><Link className="public-nav-create" data-public-event="signup_start" href="/?start=signup">Create a workspace</Link></nav></header>;
}
