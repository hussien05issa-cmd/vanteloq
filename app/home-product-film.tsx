"use client";

import { useEffect, useRef, useState } from 'react';
import { useMotionPreference } from './use-motion-preference';
import './home-product-film.css';

export default function HomeProductFilm() {
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const motion = useMotionPreference();

  useEffect(() => {
    if (!loaded || failed) return;
    const element = video.current; if (!element) return;
    let cancelled = false;
    element.focus({ preventScroll: true });
    element.play().catch(() => { if (!cancelled) setMessage('Use the player’s play control to watch the film.'); });
    return () => { cancelled = true; element.pause(); };
  }, [loaded, failed]);
  useEffect(() => {
    const pause = () => { if (document.hidden) video.current?.pause(); };
    document.addEventListener('visibilitychange', pause);
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) video.current?.pause();
    }, { threshold: .1 }) : null;
    if (stage.current) observer?.observe(stage.current);
    return () => { document.removeEventListener('visibilitychange', pause); observer?.disconnect(); };
  }, []);
  useEffect(() => { if (!motion) video.current?.pause(); }, [motion]);
  const watch = () => { if (failed) video.current?.load(); setMessage(''); setFailed(false); setLoaded(true); };

  return <section className="home-product-film" id="product-film" aria-labelledby="product-film-title">
    <div className="home-film-copy" data-motion-item="0">
      <p className="demo-eyebrow">VANTELOQ IN MOTION</p>
      <h2 id="product-film-title">See the picture <br/><em>come together.</em></h2>
      <p>Your sales. Your stock. Your next step. Bring the records into one clear view, then make the dashboard your own.</p>
      <a href="/demo">Explore the working demo <span aria-hidden="true">↗</span></a>
      <span className="home-film-data-note">Fictional sample records. Your workspace uses your own permitted data.</span>
    </div>
    <div className="home-film-card" data-motion-item="1">
      <div className="home-film-top"><span><i aria-hidden="true"/>Vanteloq v1.0 Origin</span><span>Product preview · 10 seconds</span></div>
      <div className="home-film-stage" ref={stage}>
        {/* A native lazy poster avoids loading the video before the visitor plays it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {(!loaded || failed) && <img src="/brand/homepage-motion-2026-10-09/vanteloq-origin-poster.webp" alt="Vanteloq’s sample commerce dashboard, with sales performance and Business Pulse." width={1920} height={1080} loading="lazy" decoding="async"/>}
        <video ref={video} hidden={!loaded || failed} tabIndex={0} poster="/brand/homepage-motion-2026-10-09/vanteloq-origin-poster.webp" preload="none" controls={loaded && !failed} playsInline muted onPlay={() => setMessage('')} onError={() => { setFailed(true); setMessage('The film could not load. Please try again, or explore the demo.'); }} aria-label="Vanteloq product film with fictional sample records">
          {loaded && <source src="/brand/homepage-motion-2026-10-09/vanteloq-origin-film.mp4" type="video/mp4"/>}
        </video>
        {!loaded && <button type="button" className="home-film-play" onClick={watch}><span aria-hidden="true">▶</span><b>Watch the film</b><small>10 seconds · Sound off</small></button>}
        {failed && <div className="home-film-error"><p role="alert">{message}</p><button type="button" onClick={watch}>Try again</button><a href="/demo">Open the demo</a></div>}
      </div>
      {!failed && message && <p className="home-film-message" role="status">{message}</p>}
      <div className="home-film-bottom"><span>Sales & sources</span><span>Stock & cash</span><span>Your goals</span></div>
    </div>
  </section>;
}
