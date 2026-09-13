import Link from "next/link";
export default function CustomPlanCallout() {
  return <section className="custom-plan-cta" aria-label="Custom subscription plan"><div><h2>Need more than a standard plan?</h2><p>Tell us about your locations, team and requirements. We’ll discuss a custom scope and price before checkout.</p></div><Link href="/custom-plan">Request a custom plan →</Link></section>;
}
