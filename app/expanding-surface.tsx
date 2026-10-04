"use client";
import { type ReactNode, type RefObject, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { surfaceFrames } from "../domain/surface-motion";
import { useModalFocus } from "./use-modal-focus";
import { useMotionPreference } from "./use-motion-preference";
import "./control-surfaces.css";

/** One shared, interruptible origin-to-panel transition, with a static fallback. */
export default function ExpandingSurface({ open, onClose, originRef, title, children }: { open: boolean; onClose: () => void; originRef: RefObject<HTMLElement | null>; title: string; children: ReactNode }) {
  const [present, setPresent] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null), animationRef = useRef<Animation | null>(null), generation = useRef(0);
  const titleId = useId(), motion = useMotionPreference();
  useModalFocus(panelRef, present, onClose);
  // Defer mounting until after hydration, preserving an interruptible opening.
  useLayoutEffect(() => { let cancelled = false; if (open) queueMicrotask(() => { if (!cancelled) setPresent(true); }); return () => { cancelled = true; }; }, [open]);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!present || !panel) return;
    const ticket = ++generation.current;
    const ongoing = animationRef.current;
    const current = ongoing ? panel.getBoundingClientRect() : null;
    ongoing?.cancel(); animationRef.current = null;
    const settle = () => { if (generation.current !== ticket) return; animationRef.current?.cancel(); animationRef.current = null; if (!open) setPresent(false); };
    if (!motion || typeof panel.animate !== "function" || document.hidden) { settle(); return; }
    const target = panel.getBoundingClientRect(), origin = originRef.current?.getBoundingClientRect();
    if (!origin || origin.width === 0 || origin.height === 0) { settle(); return; }
    const frames = surfaceFrames(open ? current ?? origin : origin, target, !open, current ?? undefined);
    if (!frames.length) { settle(); return; }
    const animation = panel.animate(frames, { duration: open ? 410 : 250, easing: "linear", fill: "both" });
    animationRef.current = animation;
    animation.finished.then(settle).catch(() => {});
    const originalSize = [panel.offsetWidth,panel.offsetHeight];
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { if(panel.offsetWidth!==originalSize[0]||panel.offsetHeight!==originalSize[1])settle(); });
    observer?.observe(panel);
    window.addEventListener("resize", settle); document.addEventListener("visibilitychange", settle);
    // Keep the current transform until the next effect samples it on interruption.
    return () => { observer?.disconnect();window.removeEventListener("resize", settle); document.removeEventListener("visibilitychange", settle); };
  }, [open, present, motion, originRef]);
  useLayoutEffect(() => () => { ++generation.current; animationRef.current?.cancel(); }, []);
  if (!present || typeof document === "undefined") return null;
  return createPortal(<div className="control-surface-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="control-surface" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="control-surface-heading"><div><span>VANTELOQ · YOUR BUSINESS</span><h2 id={titleId}>{title}</h2></div><button type="button" className="surface-close" onClick={onClose} aria-label={`Close ${title}`}>×</button></header>
      <div className="control-surface-content">{children}</div>
    </div>
  </div>, document.body);
}
