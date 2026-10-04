"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { HOME_DEMO as demo, sampleMoney as money } from "../domain/homepage-demo";
import { useMotionPreference } from "./use-motion-preference";
import ProductBrandLogo from "./product-brand-logo";
const STEPS = ["sources", "overview", "comparison", "review"] as const;
const LABELS = ["Sources", "Overview", "What changed", "Review"];
const MEDIA = "/brand/homepage-media-2026-10-03/hero-";

export function SampleContext() { return <p className="hp-sample">Fictional records · CAD · All sample locations<br/>{demo.period.label} · 28 days</p>; }
export function SalesBars() {
  const max = Math.max(...demo.weeks.map(row => row.salesCents));
  return <div className="hp-sales-chart" role="img" aria-label={`Net sales by week within May 29 to June 25: ${demo.weeks.map(row => `${row.label}: ${money(row.salesCents)}`).join("; ")}.`}><div className="hp-chart-title"><strong>Net sales by week</strong><span>CAD</span></div><div className="hp-bars">{demo.weeks.map(row => <div key={row.label}><span>{money(row.salesCents, 0)}</span><i style={{ height: `${Math.max(8, row.salesCents / max * 100)}%` }}/><small>{row.label}</small></div>)}</div></div>;
}
export function SalesBridge() { return <dl className="hp-bridge">{demo.bridge.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{money(row.impactCents)}</dd></div>)}<div className="hp-bridge-total"><dt>Total sales change</dt><dd>{money(demo.current.netCents - demo.prior.netCents)}</dd></div></dl>; }

export default function HomepageStory() {
  const motion = useMotionPreference();
  const [desktop, setDesktop] = useState(false), [visible, setVisible] = useState(false), [pageVisible, setPageVisible] = useState(true), [saveData, setSaveData] = useState(true);
  const [started, setStarted] = useState(false), [paused, setPaused] = useState(false), [finished, setFinished] = useState(false), [step, setStep] = useState(0), [failed, setFailed] = useState(false);
  const stage = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null), elapsed = useRef(0), automaticStarted = useRef(false), wasMotion = useRef(false);
  const playing = started && !paused && !finished && visible && pageVisible;
  useEffect(() => {
    const media = matchMedia("(min-width: 801px)");
    setSaveData(Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData));
    const resize = () => setDesktop(media.matches); resize(); media.addEventListener("change", resize);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .15 });
    if (stage.current) observer.observe(stage.current);
    const visibility = () => setPageVisible(!document.hidden); visibility(); document.addEventListener("visibilitychange", visibility);
    return () => { media.removeEventListener("change", resize); observer.disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => {
    if (motion && desktop && visible && !saveData && !automaticStarted.current && !started) { automaticStarted.current = true; setStarted(true); }
    if (wasMotion.current && !motion) setPaused(true);
    wasMotion.current = motion;
  }, [motion, desktop, visible, started, saveData]);
  useEffect(() => {
    if (!playing) { video.current?.pause(); return; }
    if (video.current && !video.current.ended) void video.current.play().catch(() => { /* Poster remains visible when playback is unavailable. */ });
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now(); elapsed.current = Math.min(12000, elapsed.current + now - last); last = now;
      setStep(Math.min(3, Math.floor(elapsed.current / 3000)));
      if (elapsed.current >= 12000) { setFinished(true); video.current?.pause(); }
    }, 150);
    return () => { clearInterval(timer); video.current?.pause(); };
  }, [playing, desktop]);
  function play(replay = false) {
    automaticStarted.current = true;
    if (replay || finished) { elapsed.current = 0; setStep(0); setFinished(false); if (video.current) video.current.currentTime = 0; }
    setStarted(true); setPaused(false);
  }
  function select(index: number) { automaticStarted.current = true; setPaused(true); setStep(index); elapsed.current = index * 3000; setFinished(false); }
  return <div className="hp-story" ref={stage} aria-label="Twelve-second product illustration" aria-live="off">
    {!failed && <div className="hp-environment" aria-hidden="true"><picture><source media="(max-width:800px)" srcSet={`${MEDIA}mobile-poster.webp`}/>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={`${MEDIA}desktop-poster.webp`} width="864" height="496" alt="" fetchPriority="high" onError={() => setFailed(true)}/></picture>{started && <video ref={video} key={desktop ? "desktop" : "mobile"} muted playsInline preload="none" poster={`${MEDIA}${desktop ? "desktop" : "mobile"}-poster.webp`} onError={() => setFailed(true)}><source src={`${MEDIA}${desktop ? "desktop" : "mobile"}.webm`} type="video/webm"/><source src={`${MEDIA}${desktop ? "desktop" : "mobile"}.mp4`} type="video/mp4"/></video>}</div>}
    <div className="hp-product-window"><div className="hp-window-title"><ProductBrandLogo product="vanteloq" className="hp-window-mark"/><strong>Retail overview</strong><span>Product illustration</span></div><SampleContext/>
      <dl className="hp-metrics"><div><dt>Net sales</dt><dd>{money(demo.current.netCents)}</dd><small>{((demo.salesChange ?? 0) * 100).toFixed(1)}% vs prior 28 days</small></div><div><dt>Transactions</dt><dd>{demo.current.purchaseBaskets}</dd><small>{demo.prior.purchaseBaskets} in prior period</small></div><div><dt>Average basket</dt><dd>{money(demo.current.averageBasketCents)}</dd><small>{money(demo.prior.averageBasketCents)} in prior period</small></div></dl>
      <div className="hp-story-scene" data-step={STEPS[step]}>
        {step === 0 && <><div className="hp-source-flow"><span>POS records</span><i aria-hidden="true">→</i><span>Reviewed import</span><i aria-hidden="true">→</i><strong>Clear totals</strong></div><SalesBars/></>}
        {step === 1 && <SalesBars/>}
        {step === 2 && <><div className="hp-chart-title"><strong>Where the change comes from</strong><span>Prior: {demo.period.prior}</span></div><SalesBridge/></>}
        {step === 3 && <div className="hp-review-scene"><span className="hp-status">Ready for your review</span><h3>Check the receipts behind the change.</h3><p>Review fewer transactions and a smaller average basket before choosing your next step.</p><Link href="/demo#retail" data-public-event="demo_view" data-public-section="hero">Inspect the sample records <span aria-hidden="true">↗</span></Link><small>Detailed receipt analysis requires a supported paid plan and source records.</small></div>}
      </div>
      <div className="hp-finding"><span>ONE FINDING</span><p>Sales fell {Math.abs((demo.salesChange ?? 0) * 100).toFixed(1)}%. Fewer transactions explain the larger share.</p></div>
    </div>
    <div className="hp-story-controls"><div role="group" aria-label="Product story steps">{STEPS.map((id, index) => <button type="button" key={id} aria-pressed={step === index} onClick={() => select(index)} data-public-event="story_step_selected" data-public-section="hero" data-public-step={id}>{index + 1}<span>{LABELS[index]}</span></button>)}</div><button type="button" className="hp-play-control" onClick={() => playing ? setPaused(true) : play(finished)} data-public-event={playing ? "hero_pause" : finished ? "hero_replay" : "hero_play"} data-public-section="hero">{playing ? "Pause" : finished ? "Replay" : started ? "Resume" : "Play story"}</button></div>
    <p className="hp-story-note">12-second illustration. Select any step. No live connection or account required.</p>
  </div>;
}
