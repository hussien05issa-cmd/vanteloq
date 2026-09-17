import Link from "next/link";
export default function CustomPlanCallout({ headingLevel = 2, title = "Need More Than a Standard Plan?", className = "" }: {
  headingLevel?: 2 | 3;
  title?: string;
  className?: string;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return <section className={`custom-plan-cta custom-plan-callout ${className}`} aria-label="Custom subscription plan">
    <div className="custom-plan-callout-copy">
      <span className="custom-plan-callout-label">Built Around Your Business</span>
      <Heading>{title}</Heading>
      <p>Tell us about your locations, team and requirements. We’ll agree on the scope and price before checkout.</p>
    </div>
    <Link className="custom-plan-callout-action" href="/custom-plan">Request a Custom Plan<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></Link>
  </section>;
}
