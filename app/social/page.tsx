/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import Link from "next/link";
import { SOCIAL_PROFILES } from "../social-profiles";
import "./social-hub.css";

export const metadata: Metadata = {
  title: "Follow Vanteloq | Lexedge Consulting",
  description: "Connect with Vanteloq on Instagram, TikTok, YouTube and Facebook. Follow product updates, practical business insights and the team behind the platform.",
  alternates: { canonical: "/social" },
  openGraph: { title: "Follow the Vanteloq Journey", description: "Business insights, product updates and the build behind Vanteloq by Lexedge Consulting.", url: "/social", type: "website" },
  twitter: { title: "Follow the Vanteloq Journey", description: "Connect with Vanteloq by Lexedge Consulting." },
};

export default function SocialHubPage() {
  return <div className="social-hub">
    <a className="social-hub-skip" href="#social-channels">Skip to Social Channels</a>
    <div className="social-hub-wrap">
      <header className="social-hub-nav">
        <div className="social-hub-brand"><a href="https://lexedgeconsulting.com/">LEXEDGE</a><span aria-hidden="true">×</span><Link href="/">VANTELOQ</Link></div>
        <Link className="social-hub-home" href="/">Visit Vanteloq <span aria-hidden="true">↗︎</span></Link>
      </header>
      <main>
        <section className="social-hub-hero" aria-labelledby="social-hub-title">
          <p className="social-hub-kicker">Connect · Learn · Grow</p>
          <h1 id="social-hub-title">Follow the <span>Vanteloq</span> journey.</h1>
          <p className="social-hub-lede">Business intelligence, practical insights and the build behind Vanteloq. Choose a platform to follow, or scan a code from another device.</p>
          <nav className="social-hub-cloud" aria-label="Jump to a social channel">
            {Object.entries(SOCIAL_PROFILES).map(([slug, profile]) => <a className={`social-hub-float social-hub-float-${slug}`} href={`#${slug}`} key={slug} aria-label={`Find Vanteloq on ${profile.name}`}><img src={`/brand/social/${slug}-mark.svg`} alt="" width={64} height={64}/></a>)}
          </nav>
          <div className="social-hub-banner"><img src="/brand/social/lexedge-vanteloq-banner.jpg" alt="Lexedge Consulting and Vanteloq. Better systems. Stronger businesses. Consulting, analytics and business software." width={1536} height={585}/></div>
        </section>
        <section className="social-hub-grid" id="social-channels" aria-label="Vanteloq social media channels">
          {Object.entries(SOCIAL_PROFILES).map(([slug, profile]) => <article className={`social-hub-card social-hub-${slug}`} id={slug} key={slug}>
            <div className="social-hub-glow" aria-hidden="true"/>
            <div className="social-hub-orb" aria-hidden="true"><img src={`/brand/social/${slug}-mark.svg`} alt="" width={64} height={64}/></div>
            <header><h2>{profile.name}</h2><p className="social-hub-handle">{profile.handle}</p></header>
            <div className="social-hub-qr"><img src={`/brand/social/${slug}-qr.svg`} alt={`QR code for Vanteloq on ${profile.name}. You can also use the link below.`} width={245} height={245} loading="lazy"/></div>
            <p className="social-hub-description">{profile.description}</p>
            <a className="social-hub-follow" href={profile.href} target="_blank" rel="noopener noreferrer" aria-label={`${slug === "youtube" ? "Subscribe" : "Follow"} on ${profile.name} (opens in a new tab)`}>{slug === "youtube" ? "Subscribe" : "Follow"} on {profile.name}<span aria-hidden="true">↗︎</span></a>
          </article>)}
        </section>
        <section className="social-hub-cta" aria-labelledby="social-hub-explore">
          <div><h2 id="social-hub-explore">Better systems.<br/>Stronger businesses.</h2><p>Consulting, analytics and business software from Lexedge Consulting and Vanteloq.</p></div>
          <div className="social-hub-cta-actions"><Link className="social-hub-explore" href="/">Explore Vanteloq <span aria-hidden="true">↗︎</span></Link><Link href="/demo">Try the Interactive Demo <span aria-hidden="true">→</span></Link></div>
        </section>
      </main>
      <footer className="social-hub-footer"><div><strong>Lexedge Consulting × Vanteloq</strong><p>Business clarity. Practical systems. Better decisions.</p></div><nav aria-label="Social page footer"><Link href="/contact">Contact</Link><Link href="/privacy">Privacy</Link><Link href="/">Home</Link></nav></footer>
    </div>
  </div>;
}
