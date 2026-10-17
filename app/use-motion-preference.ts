"use client";
import { useEffect, useState } from "react";

export function useMotionPreference() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => {
      document.documentElement.dataset.motion = "system";
      try { window.localStorage.removeItem("vanteloq.motion"); } catch { /* Motion still follows the device setting. */ }
      setEnabled(!media.matches);
    };
    read(); media.addEventListener("change", read);
    return () => media.removeEventListener("change", read);
  }, []);
  return enabled;
}
