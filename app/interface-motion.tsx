"use client";

import { useEffect } from "react";

const surfaces = [
  ".public-site main > section:not(.home-hero) > :not(script):not(style):not([id]:empty)",
  ".hero-product-hotspot > span",
  ".public-site .home-provider-tiles > button",
  ".executive-kpi", ".executive-detail", ".executive-insights",
  ".finance-chart", ".bq-cash-metrics > article", ".bq-cash-observations",
  ".integration-card", ".metric-card", ".stat-card", ".panel",
  ".auth-panel", ".provider-setup-details", "[data-motion-surface]", "[data-motion-item]", ".vanteloq-ai-logo",
].join(",");

// Content is visible by default. Motion never gates rendering or data access.
export default function InterfaceMotion() {
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!("IntersectionObserver" in window) || !("animate" in Element.prototype)) return;
    let stop = () => {};
    const start = () => {
      stop();
      if (preference.matches) return;
      const seen = new WeakSet<Element>();
      const active = new Map<Element, Animation>();
      const queued = new Set<Element>();
      const pending = new Set<Element>();
      let frame = 0;
      const compact = window.matchMedia("(max-width: 640px)").matches;
      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.target.matches(".vanteloq-ai-logo")) {
            (entry.target as HTMLElement).dataset.motionVisible = String(entry.isIntersecting);
            continue;
          }
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          pending.delete(entry.target);
          if (entry.target.contains(document.activeElement) || document.hidden) continue;
          const item = entry.target as HTMLElement;
          const sequence = Number(item.dataset.motionItem || 0);
          if (item.classList.contains("home-ring-visual")) item.dataset.motionEntered = "true";
          const animation = entry.target.animate([
            { opacity: .76, translate: `0 ${compact ? 10 : 20}px` },
            { opacity: 1, translate: "0 0" },
          ], { duration: compact ? 380 : 580, delay: Math.min(Math.max(sequence, 0) * 55, compact ? 110 : 165), fill: "backwards", easing: "cubic-bezier(.16,1,.3,1)" });
          active.set(entry.target, animation);
          animation.onfinish = animation.oncancel = () => active.delete(entry.target);
        }
      }, { threshold: 0, rootMargin: "0px 0px -16px 0px" });
      const collect = (root: Element, initial = false) => {
        const candidates = root.matches(surfaces) ? [root] : [];
        candidates.push(...root.querySelectorAll(surfaces));
        for (const element of candidates) {
          if (seen.has(element) || !element.isConnected) continue;
          seen.add(element);
          if (element.matches(".vanteloq-ai-logo")) { observer.observe(element); continue; }
          // Animate the outer surface only, never nested tables, chart marks or amounts.
          if (element.hasAttribute("data-motion-group") || element.querySelector("[data-motion-item]")) continue;
          if (!element.hasAttribute("data-motion-item") && element.parentElement?.closest(surfaces)) continue;
          if (element.closest('[data-motion="off"], [aria-live], [role="alert"], [role="status"]')) continue;
          // Do not delay the first screen or animate content already read on arrival.
          if (initial && !element.matches(".hero-product-hotspot > span") && element.getBoundingClientRect().top < window.innerHeight) continue;
          pending.add(element);
          observer.observe(element);
        }
      };
      collect(document.body, true);
      const mutations = new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.removedNodes) {
            if (!(node instanceof Element)) continue;
            for (const [element, animation] of active) {
              if (node === element || node.contains(element)) animation.cancel();
            }
            if (node.matches(surfaces)) observer.unobserve(node);
            node.querySelectorAll(surfaces).forEach(element => observer.unobserve(element));
          }
          for (const node of record.addedNodes) if (node instanceof Element) queued.add(node);
        }
        for (const element of pending) if (!element.isConnected) { observer.unobserve(element); pending.delete(element); }
        if (queued.size && !frame) frame = requestAnimationFrame(() => {
          frame = 0;
          // React may add both a panel and its children in the same batch.
          // Scan the outer subtree once instead of re-scanning every child.
          for (const node of queued) {
            if (!node.isConnected) continue;
            let parent = node.parentElement;
            while (parent && !queued.has(parent)) parent = parent.parentElement;
            if (!parent) collect(node);
          }
          queued.clear();
        });
      });
      mutations.observe(document.body, { childList: true, subtree: true });
      const settle = () => {
        document.documentElement.dataset.motionPaused = String(document.hidden);
        for (const animation of active.values()) animation.cancel();
      };
      const focus = (event: FocusEvent) => {
        if (!(event.target instanceof Element)) return;
        // The closest matching card may be inside the actual animated panel.
        // Settle every containing surface before the user interacts with it.
        for (const surface of pending) if (surface.contains(event.target)) {
          observer.unobserve(surface);
          pending.delete(surface);
        }
        for (const [surface, animation] of active) if (surface.contains(event.target)) animation.cancel();
      };
      document.addEventListener("focusin", focus);
      document.addEventListener("visibilitychange", settle);
      stop = () => {
        observer.disconnect();
        mutations.disconnect();
        cancelAnimationFrame(frame);
        queued.clear();
        pending.clear();
        settle();
        document.removeEventListener("focusin", focus);
        document.removeEventListener("visibilitychange", settle);
      };
    };
    start();
    preference.addEventListener("change", start);
    return () => { stop(); preference.removeEventListener("change", start); };
  }, []);
  return null;
}
