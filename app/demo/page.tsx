import type { Metadata } from "next";
import Link from "next/link";
import ProductDemo from "../product-demo";
import ProductBrandLogo from "../product-brand-logo";

export const metadata: Metadata = { title: "Interactive retail analytics demo | Vanteloq", description: "Explore revenue drivers, product performance, basket analysis, inventory and BookLoQ cash scenarios with fictional retail records. No signup required.", alternates: { canonical: "/demo" } };

export default function DemoPage() {
  return <div className="public-site demo-page"><header className="demo-page-nav"><Link href="/" aria-label="Vanteloq home"><ProductBrandLogo product="vanteloq"/><strong>Vanteloq</strong></Link><span>THE INTERACTIVE DEMO</span><Link href="/">Open Vanteloq →</Link></header><main><ProductDemo standalone/></main><footer className="demo-page-footer"><span>Vanteloq by LexEdge Consulting</span><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/subprocessors">Subprocessors</Link></footer></div>;
}

