"use client";

import { useEffect, useRef, useState } from "react";

/** A light product display that leads directly to the working, inspectable example. */
export default function HomeCinematicDashboard({ motionEnabled }: { motionEnabled: boolean }) {
  const link = useRef<HTMLAnchorElement>(null);
  const surface = useRef<HTMLSpanElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth) setReady(true);
  }, []);

  useEffect(() => {
    const element = link.current, stage = surface.current;
    if (!element || !stage || !motionEnabled) return;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let visible = true, frame = 0, clientX = 0, clientY = 0;
    const reset = () => {
      cancelAnimationFrame(frame); frame = 0;
      stage.style.removeProperty("--hero-turn-x");
      stage.style.removeProperty("--hero-turn-y");
    };
    const update = () => {
      frame = 0;
      if (!visible || document.hidden || !finePointer.matches) return;
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const x = Math.max(-1, Math.min(1, (clientX - box.left) / box.width * 2 - 1));
      const y = Math.max(-1, Math.min(1, (clientY - box.top) / box.height * 2 - 1));
      stage.style.setProperty("--hero-turn-x", `${-y}deg`);
      stage.style.setProperty("--hero-turn-y", `${x * 1.4}deg`);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.buttons || !visible || document.hidden || !finePointer.matches) return;
      clientX = event.clientX; clientY = event.clientY;
      if (!frame) frame = requestAnimationFrame(update);
    };
    const syncVisibility = () => {
      element.dataset.active = String(visible && !document.hidden);
      if (!visible || document.hidden) reset();
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false; syncVisibility();
    });
    observer?.observe(element);
    syncVisibility();
    element.addEventListener("pointermove", move, { passive: true });
    for (const event of ["pointerleave", "pointercancel", "pointerdown", "focusin"]) element.addEventListener(event, reset);
    document.addEventListener("visibilitychange", syncVisibility);
    window.addEventListener("blur", reset);
    window.addEventListener("resize", reset, { passive: true });
    finePointer.addEventListener("change", reset);
    return () => {
      reset(); observer?.disconnect(); delete element.dataset.active;
      element.removeEventListener("pointermove", move);
      for (const event of ["pointerleave", "pointercancel", "pointerdown", "focusin"]) element.removeEventListener(event, reset);
      document.removeEventListener("visibilitychange", syncVisibility);
      window.removeEventListener("blur", reset);
      window.removeEventListener("resize", reset);
      finePointer.removeEventListener("change", reset);
    };
  }, [motionEnabled]);

  return <figure className="home-editorial-visual">
    <a ref={link} className="home-cinematic-link" href="#dashboard-preview" aria-label="Explore the interactive sample dashboard" data-motion={motionEnabled ? "on" : "off"} data-ready={ready}>
      <span className="home-cinematic-entry">
        <span ref={surface} className="home-cinematic-stage">
          <picture>
            <img ref={image} src="/brand/hero-dashboard-2026-10-16/dashboard-1440.webp" srcSet="/brand/hero-dashboard-2026-10-16/dashboard-640.webp 640w, /brand/hero-dashboard-2026-10-16/dashboard-960.webp 960w, /brand/hero-dashboard-2026-10-16/dashboard-1440.webp 1440w, /brand/hero-dashboard-2026-10-16/dashboard-1920.webp 1920w" sizes="(max-width: 800px) calc(100vw - 40px), (max-width: 1600px) 52vw, 740px" alt="Vanteloq dashboard on a cinematic display, with sample sales, margins and goal rings." width={2560} height={1712} loading="eager" fetchPriority="high" decoding="async" onLoad={() => setReady(true)}/>
          </picture>
          <span className="home-cinematic-cue" aria-hidden="true">Explore dashboard <span>↗</span></span>
        </span>
      </span>
    </a>
    <figcaption>Dashboard illustration · Sample data</figcaption>
  </figure>;
}
