"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Match SVG coordinates to CSS pixels so a wide card does not enlarge its text.
 * Small cards retain an internally scrollable plot. This never changes data. */
export function useChartWidth(initialWidth: number, minimumWidth = 520) {
  const [width, setWidth] = useState(initialWidth);
  const observer = useRef<ResizeObserver | null>(null);
  const elementRef = useRef<HTMLDivElement | null>(null);
  const observe = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!element) return;
    const update = (measured: number) => {
      if (Number.isFinite(measured) && measured > 0) setWidth(Math.max(minimumWidth, Math.round(measured)));
    };
    update(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) update(entry.contentRect.width);
    });
    observer.current.observe(element);
  }, [minimumWidth]);
  const ref = useCallback((element: HTMLDivElement | null) => {
    elementRef.current = element;
    observe(element);
  }, [observe]);
  useEffect(() => {
    // Reattach after Strict Mode's effect cleanup as well as a minimum-width change.
    observe(elementRef.current);
    return () => observer.current?.disconnect();
  }, [observe]);
  return { ref, width };
}
