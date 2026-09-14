import type { Metadata } from "next";
import Link from "next/link";
import PublicPageNav from "../public-page-nav";
import CustomPlanForm from "../custom-plan-form";

export const metadata: Metadata = { title: "Contact Vanteloq | Product and privacy requests", description: "Send a product question or privacy request to the Vanteloq team through our private contact form.", alternates: { canonical: "/contact" } };
export default function ContactPage() {
  return <div className="public-site demo-page"><PublicPageNav/><main className="custom-plan-page"><section className="custom-plan-intro"><p className="demo-eyebrow">CONTACT VANTELOQ</p><h1>Let’s get you the right help.</h1><p>Ask about the product, your workspace or your privacy rights. Privacy requests are routed to the Vanteloq Privacy Officer.</p><p>Include only what we need to understand your request. Do not send passwords, verification codes, identity documents or customer records.</p><Link href="/custom-plan">Looking for a custom plan? →</Link></section><section className="custom-plan-card" aria-label="Private contact form"><CustomPlanForm purpose="contact"/></section></main></div>;
}
