"use client";

import { useEffect } from "react";
import { useMotionPreference } from "../use-motion-preference";

const revealSelector = "[data-advisory-reveal]";

export default function AdvisoryMotion() {
  const motion = useMotionPreference();

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".advisory-main");
    if (!root) return;

    const groups = Array.from(root.querySelectorAll<HTMLElement>(revealSelector));
    const reset = () => {
      delete root.dataset.advisoryMotion;
      groups.forEach(group => delete group.dataset.advisoryVisible);
    };

    // Content is visible by default. Enhancement only starts when the browser
    // supports observation and the visitor has not requested reduced motion.
    if (!motion || !("IntersectionObserver" in window)) {
      reset();
      return;
    }

    groups.forEach(group => delete group.dataset.advisoryVisible);

    const previousMotionPaused = document.documentElement.dataset.motionPaused;
    const reveal = (group: HTMLElement) => {
      group.dataset.advisoryVisible = "true";
      observer.unobserve(group);
    };
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        reveal(entry.target as HTMLElement);
      }
    }, { threshold: .12, rootMargin: "0px 0px -8% 0px" });

    // Keep anything already in the viewport visible before enabling enhanced
    // hidden states. This avoids a visible-hide-reveal flash during hydration
    // and when the page opens directly on an anchor.
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    for (const group of groups) {
      const bounds = group.getBoundingClientRect();
      if (group.contains(document.activeElement) || (bounds.bottom > 0 && bounds.top < viewportHeight * .92)) reveal(group);
    }
    root.dataset.advisoryMotion = "ready";

    // Wait one frame so the enhanced starting state is committed before an
    // in-view group transitions to its final state.
    const frame = requestAnimationFrame(() => {
      for (const group of groups) {
        if (!group.dataset.advisoryVisible) observer.observe(group);
      }
    });
    const revealFocusedGroup = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return;
      const group = event.target.closest<HTMLElement>(revealSelector);
      if (group && !group.dataset.advisoryVisible) reveal(group);
    };
    const updateVisibility = () => {
      document.documentElement.dataset.motionPaused = String(document.hidden);
    };

    document.addEventListener("focusin", revealFocusedGroup);
    document.addEventListener("visibilitychange", updateVisibility);
    updateVisibility();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("focusin", revealFocusedGroup);
      document.removeEventListener("visibilitychange", updateVisibility);
      if (previousMotionPaused === undefined) delete document.documentElement.dataset.motionPaused;
      else document.documentElement.dataset.motionPaused = previousMotionPaused;
      reset();
    };
  }, [motion]);

  return null;
}
