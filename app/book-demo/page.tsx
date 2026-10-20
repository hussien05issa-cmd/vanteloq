import PublicSurface from "../public-surface";
import type { Metadata } from "next";
import PublicPageNav from "../public-page-nav";
import CustomPlanForm from "../custom-plan-form";

export const metadata: Metadata = {
  title: "Book a free demo | Vanteloq",
  description: "Request a free Vanteloq demo for your business. Share your current systems and questions, and our team will contact you to arrange a time. No obligation or card required.",
  alternates: { canonical: "/book-demo" },
};

export default function BookDemoPage() {
  return <PublicSurface className="demo-page"><PublicPageNav/>
    <main className="custom-plan-page book-demo-page">
      <section className="custom-plan-intro"><p className="demo-eyebrow">FREE VANTELOQ DEMO</p><h1>See how Vanteloq fits your business.</h1><p>Tell us about your business, your current systems and the questions you want to explore. Our team will review your request and contact you to arrange a demo.</p><ul><li>Explore business reporting and the workflows that matter to you.</li><li>Discuss your current POS, data and integration requirements.</li><li>Ask questions and review whether Vanteloq fits your needs.</li></ul><p className="custom-plan-hint">$0, no obligation and no card required. Sending this request starts a scheduling conversation. Your appointment is confirmed when we agree on a time with you.</p></section>
      <section className="custom-plan-card" aria-label="Free demo request form"><CustomPlanForm purpose="demo"/></section>
    </main>
  </PublicSurface>;
}
