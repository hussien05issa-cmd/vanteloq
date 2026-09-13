import type { Metadata } from "next";
import Link from "next/link";
import ProductBrandLogo from "../product-brand-logo";
import CustomPlanForm from "../custom-plan-form";
export const metadata: Metadata = { title: "Custom plans | Vanteloq", description: "Need more locations, a larger team or a tailored rollout? Tell Vanteloq about your business requirements and request a custom plan.", alternates: { canonical: "/custom-plan" } };
export default function CustomPlanPage() {
  return <div className="public-site demo-page"><header className="demo-page-nav"><Link href="/" aria-label="Vanteloq home"><ProductBrandLogo product="vanteloq"/><strong>Vanteloq</strong></Link><Link href="/pricing">Compare plans</Link><Link href="/demo">Try the demo</Link></header>
    <main className="custom-plan-page"><section><p className="demo-eyebrow">CUSTOM PLAN</p><h1>A plan for your next stage.</h1><p>More locations, a larger team or a more involved rollout? Tell us what you need. We’ll review the fit and discuss a scope built around your business.</p><ul><li>Capacity beyond the standard plans</li><li>Supported integrations and data requirements</li><li>BookLoQ, permissions and rollout support</li></ul><p className="custom-plan-hint">A conversation first. Scope, availability and pricing are confirmed before you subscribe.</p></section><CustomPlanForm/></main>
  </div>;
}
