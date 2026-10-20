"use client";

import { useEffect, useRef, useState } from 'react';
import { useMotionPreference } from './use-motion-preference';
import { playProductFilm } from './play-product-film';
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
    element.focus({ preventScroll: true });
    return () => element.pause();
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
  const watch = () => {
    setMessage(''); setFailed(false); setLoaded(true);
    playProductFilm(video.current, () => setMessage('Select Play to watch the overview, or use the player’s controls.'));
  };

  return <section className="home-product-film" id="product-film" aria-labelledby="product-film-title">
    <div className="home-film-copy" data-motion-item="0">
      <p className="demo-eyebrow">VANTELOQ IN MOTION</p>
      <h2 id="product-film-title">See the picture <br/><em>come together.</em></h2>
      <p>Your sales. Your stock. Your next step. Bring the records into one clear view, then take the figures into an Excel review with Data Studio.</p>
      <a href="/demo">Explore the working demo <span aria-hidden="true">↗</span></a>
      <span className="home-film-data-note">Fictional sample records. Your workspace uses your own permitted data.</span>
    </div>
    <div className="home-film-card" data-motion-item="1">
      <div className="home-film-top"><span><i aria-hidden="true"/>Vanteloq v1.0 Origin</span><span>Product preview · 12 seconds</span></div>
      <div className="home-film-stage" ref={stage}>
        {/* A native lazy poster avoids loading the video before the visitor plays it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {(!loaded || failed) && <img src="/brand/homepage-glass-2026-10-13/product-poster.webp" alt="Vanteloq’s dark commerce dashboard illustration with readable sample sales, profit and margin figures." width={1920} height={1080} loading="lazy" decoding="async"/>}
        <video ref={video} src="/films/overview-v1" hidden={!loaded || failed} tabIndex={0} poster="/brand/homepage-glass-2026-10-13/product-poster.webp" preload="none" controls={loaded && !failed} playsInline muted onPlay={() => setMessage('')} onError={() => { setFailed(true); setMessage('The film could not load. Please try again, or explore the demo.'); }} aria-label="Vanteloq overview film. Fictional sample records."/>
        {failed && <div className="home-film-error"><p role="alert">{message}</p><button type="button" onClick={watch}>Try again</button><a href="/demo">Open the demo</a></div>}
      </div>
      {(!loaded || !!message && !failed) && <div className="home-film-play-row"><button type="button" className="home-film-play" onClick={watch}><span aria-hidden="true">▶</span><b>{loaded ? 'Play the overview' : 'Watch Vanteloq overview'}</b><small>12 seconds · Sound off</small></button></div>}
      {!failed && message && <p className="home-film-message" role="status">{message}</p>}
      <div className="home-film-bottom"><span>Your overview</span><span>The source records</span><span>Data Studio</span></div>
    </div>
  </section>;
}
