import type { Metadata } from "next";
import Link from "next/link";
import CustomPlanForm from "../custom-plan-form";
import DiscoveryShell from "../discovery-shell";
import SocialLinks from "../social-links";
import { absoluteUrl, DEFAULT_SOCIAL_IMAGE, safeJsonLd } from "../seo";
import "./advisory.css";

export const metadata: Metadata = {
  title: "Vanteloq Advisory | Business Advisory and Implementation",
  description: "Practical business advisory, analytics and implementation for owner-led businesses. Based in Edmonton, Alberta, and available virtually or in person.",
  alternates: { canonical: "/advisory" },
  openGraph: {
    type: "website",
    url: "/advisory",
    title: "Vanteloq Advisory | Clear Decisions and Practical Follow-Through",
    description: "Work with Vanteloq Advisory to understand performance, set priorities and implement practical improvements.",
    images: [{ url: DEFAULT_SOCIAL_IMAGE, width: 1254, height: 1254, alt: "Vanteloq glass blue and silver logo" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vanteloq Advisory | Business Advisory and Implementation",
    description: "Understand the question, decide what matters and put the improvement into practice.",
    images: [DEFAULT_SOCIAL_IMAGE],
  },
};

const team = [
  {
    name: "Zak Mohamed",
    slug: "zak-mohamed",
    title: "Partner, Data Analytics",
    description: "Performance measures, reporting and decision support.",
    width: 1086,
    height: 1448,
  },
  {
    name: "Ahmed Yassin",
    slug: "ahmed-yassin",
    title: "Partner, Accounting",
    description: "Organized financial information, reporting and accounting oversight.",
    width: 1086,
    height: 1448,
  },
  {
    name: "Hussien Issa",
    slug: "hussien-issa",
    title: "Founder and Managing Director",
    description: "Business strategy informed by retail operations, law, data analytics and finance.",
    width: 1024,
    height: 1280,
  },
] as const;

const capabilities = [
  {
    title: "Growth and Operations",
    description: "Clarify priorities, customer opportunities, operating constraints and the processes behind consistent execution.",
  },
  {
    title: "Analytics and Financial Intelligence",
    description: "Review sales, margins, cash, inventory and reporting so important decisions have evidence behind them.",
  },
  {
    title: "Implementation and Workspace Setup",
    description: "Turn the decision into clear responsibilities, practical workflows, useful reporting and a review process your team can continue.",
  },
] as const;

const method = [
  ["Understand", "Learn the business context and the question that needs attention."],
  ["Diagnose", "Review the relevant operations, information and assumptions."],
  ["Decide", "Agree on the priority, scope and measure of progress."],
  ["Implement", "Put the change into practice with clear ownership."],
  ["Review", "Check the outcome, keep what works and adjust what does not."],
] as const;

const questions = [
  ["Who is Vanteloq Advisory for?", "We work with owner-led and independent businesses that need a clearer view of growth, operations, reporting or implementation. The first conversation is used to confirm whether the question fits our experience and scope."],
  ["Do I need Vanteloq Workspace?", "No. Advisory can be a focused engagement on its own. When the Workspace is useful, it can keep approved sources, analysis, responsibilities and follow-up work connected."],
  ["What happens in the first conversation?", "We start with one business priority, ask about the context and identify the information needed to understand it. If there is a useful next step, we explain the proposed scope before any paid work begins."],
  ["What results should I expect?", "The aim is a better-defined priority, practical next steps and clearer ownership. Results depend on the business, the starting information and how the agreed work is implemented, so we do not promise a fixed financial outcome."],
] as const;

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Service",
      "@id": `${absoluteUrl("/advisory")}#service`,
      name: "Vanteloq Advisory",
      serviceType: "Business advisory and implementation",
      url: absoluteUrl("/advisory"),
      description: "Business advisory, analytics and implementation for owner-led businesses, available independently or alongside Vanteloq Workspace.",
      provider: { "@id": `${absoluteUrl()}#organization` },
      areaServed: [
        { "@type": "City", name: "Edmonton" },
        { "@type": "AdministrativeArea", name: "Alberta" },
        { "@type": "Country", name: "Canada" },
      ],
    },
    ...team.map(person => ({
      "@type": "Person",
      "@id": `${absoluteUrl("/advisory")}#${person.slug}`,
      name: person.name,
      jobTitle: person.title,
      image: absoluteUrl(`/brand/advisory/team/${person.slug}.webp`),
      worksFor: { "@id": `${absoluteUrl()}#organization` },
    })),
  ],
};

export default function AdvisoryPage() {
  return <DiscoveryShell className="advisory-site">
    <main id="discovery-main" className="advisory-main">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(structuredData) }} />

      <header className="advisory-hero" aria-labelledby="advisory-title">
        <div className="advisory-hero-copy">
          <p className="advisory-eyebrow">Vanteloq Advisory</p>
          <h1 id="advisory-title">Clearer Business Decisions. <span>Practical <span className="advisory-keep-together">Follow-Through.</span></span></h1>
          <p className="advisory-lead">Vanteloq Advisory helps owner-led businesses understand performance, set priorities and implement practical improvements. Work with our team independently or alongside Vanteloq Workspace.</p>
          <div className="advisory-actions">
            <a className="advisory-button advisory-button-primary" href="#contact">Talk to an Advisor <span aria-hidden="true">↗</span></a>
            <a className="advisory-button advisory-button-secondary" href="#method">See How We Work <span aria-hidden="true">↓</span></a>
          </div>
          <p className="advisory-location">Based in Edmonton, Alberta. Available virtually and in person.</p>
        </div>
        <aside className="advisory-outcome-card" aria-label="What a focused engagement creates">
          <p>One priority at a time</p>
          <h2>A useful answer has to work in the business.</h2>
          <dl>
            <div><dt>Focus</dt><dd>A clearly defined question</dd></div>
            <div><dt>Direction</dt><dd>A practical next move</dd></div>
            <div><dt>Follow-through</dt><dd>Ownership and a review point</dd></div>
          </dl>
        </aside>
      </header>

      <section className="advisory-section advisory-team" aria-labelledby="team-title">
        <div className="advisory-section-heading">
          <p className="advisory-eyebrow">Meet the Team</p>
          <h2 id="team-title">A Small Team Focused on the Problem in Front of You.</h2>
          <p>You work with the people doing the analysis, shaping the recommendation and helping put it into practice.</p>
        </div>
        <div className="advisory-team-grid">
          {team.map(person => <article className="advisory-team-card" key={person.slug}>
            <picture>
              <source srcSet={`/brand/advisory/team/${person.slug}-256.webp 256w, /brand/advisory/team/${person.slug}-480.webp 480w, /brand/advisory/team/${person.slug}-768.webp 768w, /brand/advisory/team/${person.slug}.webp ${person.width}w`} sizes="(max-width: 680px) 88px, (max-width: 980px) 40vw, 360px" type="image/webp" />
              <img src={`/brand/advisory/team/${person.slug}-480.webp`} width={person.width} height={person.height} alt={`Portrait of ${person.name}`} loading="lazy" decoding="async" />
            </picture>
            <div><h3>{person.name}</h3><p className="advisory-team-title">{person.title}</p><p>{person.description}</p></div>
          </article>)}
        </div>
      </section>

      <section className="advisory-section advisory-capabilities" aria-labelledby="capabilities-title">
        <div className="advisory-section-heading advisory-section-heading-split">
          <div><p className="advisory-eyebrow">How Advisory Helps</p><h2 id="capabilities-title">Start With the Question That Needs an Answer.</h2></div>
          <p>We narrow the work to the business decision in front of you, then connect the analysis to a change your team can use.</p>
        </div>
        <div className="advisory-capability-grid">
          {capabilities.map((capability, index) => <article key={capability.title}>
            <span aria-hidden="true">{index + 1}</span><h3>{capability.title}</h3><p>{capability.description}</p>
          </article>)}
        </div>
        <a className="advisory-inline-action" href="#contact">Discuss Your Priority <span aria-hidden="true">↗</span></a>
      </section>

      <section id="method" className="advisory-section advisory-method" aria-labelledby="method-title">
        <div className="advisory-section-heading">
          <p className="advisory-eyebrow">The Advisory Method</p>
          <h2 id="method-title">From a Business Question to a Working Improvement.</h2>
          <p>Each stage earns the next. We keep the work visible, scoped and connected to a decision.</p>
        </div>
        <ol className="advisory-method-list">
          {method.map(([title, description], index) => <li key={title}>
            <span>{index + 1}</span><div><h3>{title}</h3><p>{description}</p></div>
          </li>)}
        </ol>
      </section>

      <section className="advisory-section advisory-story" aria-labelledby="story-title">
        <div className="advisory-story-copy">
          <p className="advisory-eyebrow">Why Vanteloq Exists</p>
          <h2 id="story-title">Built From the Decisions Behind a Growing Business.</h2>
          <p>Hussien started a retail business with his brother and helped scale it. As the company grew, the difficult part became connecting stock, cash, customers and day-to-day decisions across separate systems.</p>
          <p>That experience shaped the advisory approach. Hussien conceived and developed Vanteloq to give business owners a more connected way to review information, decide what matters and follow the work through.</p>
          <div className="advisory-story-note"><strong>The next chapter</strong><span>Our advisory work began as Lexedge Consulting and is now part of Vanteloq.</span></div>
        </div>
        <figure className="advisory-film">
          <video controls playsInline preload="none" poster="/brand/advisory/vanteloq-advisory-origin-poster.webp" aria-label="Vanteloq Advisory origin film">
            <source src="/brand/advisory/vanteloq-advisory-origin-film.mp4" type="video/mp4" />
            Your browser does not support this video. The adjacent story explains how the advisory work and Vanteloq began.
          </video>
          <figcaption><strong>Our origin film</strong><span>Meet the team and hear the business experience behind the work. The written story beside the film provides the key context.</span></figcaption>
        </figure>
      </section>

      <section className="advisory-section advisory-workspace" aria-labelledby="workspace-title">
        <div className="advisory-section-heading">
          <p className="advisory-eyebrow">Advisory and Workspace</p>
          <h2 id="workspace-title">Use Advisory With or Without Vanteloq Workspace.</h2>
        </div>
        <div className="advisory-workspace-grid">
          <article><p>Human Service</p><h3>Vanteloq Advisory</h3><p>Work with the team to understand a problem, choose a priority and implement an improvement. A software subscription is not required.</p></article>
          <article><p>Connected Follow-Through</p><h3>Advisory + Workspace</h3><p>Keep approved sources, analysis, decisions, responsibilities and follow-up work connected inside Vanteloq.</p></article>
        </div>
        <div className="advisory-workspace-actions">
          <Link className="advisory-inline-action" href="/how-it-works">Explore Vanteloq Workspace <span aria-hidden="true">↗</span></Link>
          <Link className="advisory-inline-action" href="/resources/business-consulting-vs-business-software">Compare Advisory and Workspace <span aria-hidden="true">↗</span></Link>
        </div>
      </section>

      <section className="advisory-section advisory-faq" aria-labelledby="faq-title">
        <div className="advisory-section-heading"><p className="advisory-eyebrow">Common Questions</p><h2 id="faq-title">What to Know Before We Talk.</h2></div>
        <div className="advisory-faq-list">
          {questions.map(([question, answer]) => <details key={question}><summary><span>{question}</span><span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}
        </div>
      </section>

      <section id="contact" className="advisory-section advisory-contact" aria-labelledby="contact-title">
        <div className="advisory-contact-copy">
          <p className="advisory-eyebrow">Talk to an Advisor</p>
          <h2 id="contact-title">Start With One Business Priority.</h2>
          <p>Tell us what is changing, what feels unclear or where the business is getting stuck. A few sentences are enough for the first step.</p>
          <div className="advisory-contact-points"><p><strong>Virtual or in person</strong><span>Meet online or in Edmonton, Alberta.</span></p><p><strong>Focused first conversation</strong><span>Bring one question. You do not need a presentation.</span></p></div>
          <a className="advisory-schedule-link" href="#advisory-inquiry-form">Request a 30-Minute Clarity Call <span aria-hidden="true">↓</span></a>
        </div>
        <div id="advisory-inquiry-form" className="advisory-contact-panel" data-inquiry-purpose="advisory"><CustomPlanForm purpose="advisory" /></div>
      </section>

      <section className="advisory-social" aria-labelledby="social-title">
        <div><p className="advisory-eyebrow">Stay Connected</p><h2 id="social-title">Follow Vanteloq.</h2><p>Product updates, practical business ideas and the work behind the platform.</p></div>
        <div className="advisory-social-actions"><SocialLinks/><Link href="/social">Open the Social Hub <span aria-hidden="true">↗</span></Link></div>
      </section>
    </main>
  </DiscoveryShell>;
}
