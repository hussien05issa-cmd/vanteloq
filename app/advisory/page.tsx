import type { Metadata } from "next";
import Link from "next/link";
import DiscoveryShell from "../discovery-shell";
import { absoluteUrl, DEFAULT_SOCIAL_IMAGE, safeJsonLd } from "../seo";
import SocialLinks from "../social-links";
import AdvisoryInquiry from "./advisory-inquiry";
import AdvisoryHeroMedia from "./advisory-hero-media";
import AdvisoryMotion from "./advisory-motion";
import "./advisory.css";

const ADVISORY_TITLE = "Business Consulting and Analytics in Edmonton | Vanteloq";
const ADVISORY_DESCRIPTION = "Business consulting, analytics and practical implementation for owner-led businesses in Edmonton, Alberta, with virtual and in-person advisory support.";
const ADVISORY_URL = absoluteUrl("/advisory");

export const metadata: Metadata = {
  title: ADVISORY_TITLE,
  description: ADVISORY_DESCRIPTION,
  alternates: { canonical: "/advisory" },
  openGraph: {
    type: "website",
    url: "/advisory",
    title: ADVISORY_TITLE,
    description: ADVISORY_DESCRIPTION,
    images: [{ url: DEFAULT_SOCIAL_IMAGE, width: 1254, height: 1254, alt: "Vanteloq glass blue and silver logo" }],
  },
  twitter: {
    card: "summary_large_image",
    title: ADVISORY_TITLE,
    description: ADVISORY_DESCRIPTION,
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
      "@id": `${ADVISORY_URL}#service`,
      name: "Vanteloq Advisory",
      serviceType: "Business consulting, analytics and implementation",
      url: ADVISORY_URL,
      description: ADVISORY_DESCRIPTION,
      provider: { "@id": `${absoluteUrl()}#organization` },
      mainEntityOfPage: { "@id": `${ADVISORY_URL}#webpage` },
      audience: { "@type": "BusinessAudience", audienceType: "Owner-led and independent businesses" },
      areaServed: [
        { "@type": "City", name: "Edmonton" },
        { "@type": "AdministrativeArea", name: "Alberta" },
        { "@type": "Country", name: "Canada" },
      ],
    },
    {
      "@type": "WebPage",
      "@id": `${ADVISORY_URL}#webpage`,
      url: ADVISORY_URL,
      name: ADVISORY_TITLE,
      description: ADVISORY_DESCRIPTION,
      mainEntity: { "@id": `${ADVISORY_URL}#service` },
      breadcrumb: { "@id": `${ADVISORY_URL}#breadcrumb` },
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${ADVISORY_URL}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Vanteloq", item: absoluteUrl() },
        { "@type": "ListItem", position: 2, name: "Vanteloq Advisory", item: ADVISORY_URL },
      ],
    },
    {
      "@type": "FAQPage",
      "@id": `${ADVISORY_URL}#faq`,
      mainEntity: questions.map(([question, answer]) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      })),
    },
    ...team.map(person => ({
      "@type": "Person",
      "@id": `${ADVISORY_URL}#${person.slug}`,
      name: person.name,
      jobTitle: person.title,
      image: absoluteUrl(`/brand/advisory/team/${person.slug}.webp`),
      worksFor: { "@id": `${absoluteUrl()}#organization` },
    })),
  ],
};

export default function AdvisoryPage() {
  return <DiscoveryShell className="advisory-site" fixedTheme="dark" primaryNavAction={{ href: "/book-demo", label: "Book a Walkthrough", shortLabel: "Walkthrough" }}>
    <main id="discovery-main" className="advisory-main">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(structuredData) }} />
      <AdvisoryMotion />

      <header className="advisory-hero" aria-labelledby="advisory-title" data-advisory-hero>
        <div className="advisory-hero-copy">
          <p className="advisory-eyebrow">Vanteloq Advisory</p>
          <h1 id="advisory-title">Clearer Business Decisions. <span className="advisory-title-accent">Practical <span className="advisory-keep-together">Follow-Through.</span></span></h1>
          <p className="advisory-lead">Vanteloq Advisory provides business consulting, analytics and practical implementation for owner-led businesses in Edmonton and virtually.</p>
          <div className="advisory-actions">
            <a className="advisory-button advisory-button-primary" href="#contact">Talk to an Advisor <span aria-hidden="true">↗</span></a>
          </div>
        </div>
        <AdvisoryHeroMedia />
        <div className="advisory-hero-meta">
          <a className="advisory-text-action" href="#method">See How We Work <span aria-hidden="true">↓</span></a>
          <p className="advisory-location">Based in Edmonton, Alberta. Available virtually and in person.</p>
        </div>
      </header>

      <section id="team" className="advisory-section advisory-team" aria-labelledby="team-title" data-advisory-reveal>
        <div className="advisory-section-heading" data-advisory-item data-advisory-order="0">
          <p className="advisory-eyebrow">Meet the Team</p>
          <h2 id="team-title">A Small Team Focused on the Problem in Front of You.</h2>
          <p>You work with the people doing the analysis, shaping the recommendation and helping put it into practice.</p>
        </div>
        <div className="advisory-team-grid">
          {team.map((person, index) => <article className="advisory-team-card" key={person.slug} data-advisory-item data-advisory-order={index + 1}>
            <picture>
              <source srcSet={`/brand/advisory/team/${person.slug}-256.webp 256w, /brand/advisory/team/${person.slug}-480.webp 480w, /brand/advisory/team/${person.slug}-768.webp 768w, /brand/advisory/team/${person.slug}.webp ${person.width}w`} sizes="(max-width: 680px) 88px, (max-width: 980px) 40vw, 360px" type="image/webp" />
              <img src={`/brand/advisory/team/${person.slug}-480.webp`} width={person.width} height={person.height} alt={`Portrait of ${person.name}`} loading="lazy" decoding="async" />
            </picture>
            <div><h3>{person.name}</h3><p className="advisory-team-title">{person.title}</p><p>{person.description}</p></div>
          </article>)}
        </div>
      </section>

      <section className="advisory-section advisory-capabilities" aria-labelledby="capabilities-title" data-advisory-reveal>
        <div className="advisory-section-heading advisory-section-heading-split" data-advisory-item data-advisory-order="0">
          <div><p className="advisory-eyebrow">How Advisory Helps</p><h2 id="capabilities-title">Start With the Question That Needs an Answer.</h2></div>
          <p>We narrow the work to the business decision in front of you, then connect the analysis to a change your team can use.</p>
        </div>
        <ul className="advisory-capability-path" role="list">
          {capabilities.map((capability, index) => <li key={capability.title} data-advisory-item data-advisory-order={index + 1}>
            <div><h3>{capability.title}</h3><p>{capability.description}</p></div>
          </li>)}
        </ul>
        <a className="advisory-inline-action" href="#contact" data-advisory-item data-advisory-order="4">Discuss Your Priority <span aria-hidden="true">↗</span></a>
      </section>

      <section id="method" className="advisory-section advisory-method" aria-labelledby="method-title" data-advisory-reveal>
        <div className="advisory-section-heading" data-advisory-item data-advisory-order="0">
          <p className="advisory-eyebrow">The Advisory Method</p>
          <h2 id="method-title">From a Business Question to a Working Improvement.</h2>
          <p>Each stage earns the next. We keep the work visible, scoped and connected to a decision.</p>
        </div>
        <div className="advisory-method-track">
          <span className="advisory-method-progress" aria-hidden="true" />
          <ol className="advisory-method-list" role="list">
            {method.map(([title, description], index) => <li key={title} data-advisory-item data-advisory-order={index + 1}>
              <span>{index + 1}</span><div><h3>{title}</h3><p>{description}</p></div>
            </li>)}
          </ol>
        </div>
      </section>

      <section className="advisory-section advisory-story" aria-labelledby="story-title" data-advisory-reveal>
        <div className="advisory-story-copy" data-advisory-item data-advisory-order="0">
          <p className="advisory-eyebrow">Why Vanteloq Exists</p>
          <h2 id="story-title">Built From the Decisions Behind a Growing Business.</h2>
          <p>Hussien started a retail business with his brother and helped scale it. As the company grew, the difficult part became connecting stock, cash, customers and day-to-day decisions across separate systems.</p>
          <p>That experience shaped the advisory approach. Hussien conceived and developed Vanteloq to give business owners a more connected way to review information, decide what matters and follow the work through.</p>
          <div className="advisory-story-note"><strong>The next chapter</strong><span>Our advisory work began as Lexedge Consulting and is now part of Vanteloq.</span></div>
        </div>
        <figure className="advisory-film" data-advisory-item data-advisory-order="1">
          <video controls playsInline preload="none" poster="/brand/advisory/vanteloq-advisory-origin-poster.webp" aria-label="Vanteloq Advisory origin film">
            <source src="/brand/advisory/vanteloq-advisory-origin-film.mp4" type="video/mp4" />
            Your browser does not support this video. The adjacent story explains how the advisory work and Vanteloq began.
          </video>
          <figcaption><strong>Our origin film</strong><span>Meet the team and hear the business experience behind the work. The written story beside the film provides the key context.</span></figcaption>
        </figure>
      </section>

      <section className="advisory-section advisory-workspace" aria-labelledby="workspace-title" data-advisory-reveal>
        <div className="advisory-section-heading" data-advisory-item data-advisory-order="0">
          <p className="advisory-eyebrow">Advisory and Workspace</p>
          <h2 id="workspace-title">Use Advisory With or Without Vanteloq Workspace.</h2>
        </div>
        <div className="advisory-workspace-grid">
          <article data-advisory-item data-advisory-order="1"><p>Human Service</p><h3>Vanteloq Advisory</h3><p>Work with the team to understand a problem, choose a priority and implement an improvement. A software subscription is not required.</p></article>
          <article data-advisory-item data-advisory-order="2"><p>Connected Follow-Through</p><h3>Advisory + Workspace</h3><p>Keep approved sources, analysis, decisions, responsibilities and follow-up work connected inside Vanteloq.</p></article>
        </div>
        <div className="advisory-workspace-actions" data-advisory-item data-advisory-order="3">
          <Link className="advisory-inline-action" href="/workspace">Explore Vanteloq Workspace <span aria-hidden="true">↗</span></Link>
          <Link className="advisory-inline-action" href="/resources/business-consulting-vs-business-software">Compare Advisory and Workspace <span aria-hidden="true">↗</span></Link>
        </div>
      </section>

      <section className="advisory-section advisory-faq" aria-labelledby="faq-title" data-advisory-reveal>
        <div className="advisory-section-heading" data-advisory-item data-advisory-order="0"><p className="advisory-eyebrow">Common Questions</p><h2 id="faq-title">What to Know Before We Talk.</h2></div>
        <div className="advisory-faq-list">
          {questions.map(([question, answer], index) => <details key={question} data-advisory-item data-advisory-order={index + 1}><summary><span>{question}</span><span aria-hidden="true">+</span></summary><div className="advisory-faq-answer"><p>{answer}</p></div></details>)}
        </div>
      </section>

      <section id="contact" className="advisory-section advisory-contact" aria-labelledby="contact-title" data-advisory-reveal>
        <div className="advisory-contact-copy" data-advisory-item data-advisory-order="0">
          <div className="advisory-call-visual" aria-hidden="true">
            <picture>
              <source srcSet="/brand/advisory/vanteloq-advisory-signal-path-480.webp 480w, /brand/advisory/vanteloq-advisory-signal-path-768.webp 768w, /brand/advisory/vanteloq-advisory-signal-path-1280.webp 1280w" sizes="(max-width: 980px) calc(100vw - 48px), 430px" type="image/webp" />
              <img src="/brand/advisory/vanteloq-advisory-signal-path-768.webp" width={768} height={430} alt="" loading="lazy" decoding="async" />
            </picture>
            <div><span>Vanteloq Advisory</span><strong>One Priority.<br/>One Clear Next Step.</strong></div>
          </div>
          <p className="advisory-eyebrow">Talk to an Advisor</p>
          <h2 id="contact-title">Start With One Business Priority.</h2>
          <p>Tell us what is changing, what feels unclear or where the business is getting stuck. A few sentences are enough for the first step.</p>
          <p className="advisory-call-details"><strong>30 minutes, virtual or in Edmonton.</strong> No payment to request. We agree on scope and fees before paid work.</p>
        </div>
        <AdvisoryInquiry />
      </section>

      <section className="advisory-social" aria-label="Follow Vanteloq" data-advisory-reveal>
        <p data-advisory-item data-advisory-order="0">Follow Vanteloq</p>
        <nav className="advisory-social-links" aria-label="Vanteloq social profiles" data-advisory-item data-advisory-order="1">
          <SocialLinks/>
          <Link className="advisory-social-hub" href="/social">Social hub <span aria-hidden="true">↗</span></Link>
        </nav>
      </section>
    </main>
  </DiscoveryShell>;
}
