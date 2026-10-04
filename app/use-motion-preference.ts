"use client";
import { useEffect, useState } from "react";
export const MOTION_PREFERENCE_EVENT = "vanteloq:motion-preference";
export function setMotionPreference(enabled: boolean) {
  try { window.localStorage.setItem("vanteloq.motion", enabled ? "system" : "off"); } catch { /* The current-page choice still works. */ }
  document.documentElement.dataset.motion = enabled ? "system" : "off";
  window.dispatchEvent(new Event(MOTION_PREFERENCE_EVENT));
}
export function useMotionPreference() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => {
      let saved = document.documentElement.dataset.motion;
      try { saved = window.localStorage.getItem("vanteloq.motion") ?? saved; } catch { /* Use current-page setting. */ }
      document.documentElement.dataset.motion = saved === "off" ? "off" : "system";
      setEnabled(!media.matches && saved !== "off");
    };
    read(); media.addEventListener("change", read); window.addEventListener(MOTION_PREFERENCE_EVENT, read); window.addEventListener("storage", read);
    return () => { media.removeEventListener("change", read); window.removeEventListener(MOTION_PREFERENCE_EVENT, read); window.removeEventListener("storage", read); };
  }, []);
  return enabled;
}
