/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { SOCIAL_PROFILES } from "./social-profiles";
import "./home-social-section.css";

export default function HomeSocialSection() {
  return <section className="home-social-section" id="social" aria-labelledby="home-social-title">
    <div className="home-social-intro">
      <div className="home-social-copy">
        <p className="demo-eyebrow">CONNECT · LEARN · GROW</p>
        <h2 id="home-social-title">Follow the Vanteloq Journey.</h2>
        <p>Product updates, practical business insights and a closer look at what we’re building.</p>
        <Link className="home-social-hub-link" href="/social">Open the Social Hub <span aria-hidden="true">↗︎</span></Link>
      </div>
      <img className="home-social-banner" src="/brand/social/lexedge-vanteloq-banner.jpg" width={1536} height={585} loading="lazy" alt="Lexedge Consulting and Vanteloq. Better systems. Stronger businesses."/>
    </div>
    <div className="home-social-cards">
      {Object.entries(SOCIAL_PROFILES).map(([slug, profile]) => <article className={`home-social-card home-social-card-${slug}`} key={slug}>
        <header><img src={`/brand/social/${slug}-mark.svg`} width={52} height={52} alt="" loading="lazy"/><div><h3>{profile.name}</h3><p>{profile.handle}</p></div></header>
        <div className="home-social-qr"><img src={`/brand/social/${slug}-qr.svg`} width={180} height={180} loading="lazy" alt={`Scan to open Vanteloq on ${profile.name}, or use the link below.`}/></div>
        <p className="home-social-description">{profile.description}</p>
        <a className="home-social-follow" href={profile.href} target="_blank" rel="noopener noreferrer" aria-label={`${slug === "youtube" ? "Subscribe" : "Follow"} on ${profile.name} (opens in a new tab)`}>{slug === "youtube" ? "Subscribe" : "Follow"} on {profile.name}<span aria-hidden="true">↗︎</span></a>
      </article>)}
    </div>
  </section>;
}
