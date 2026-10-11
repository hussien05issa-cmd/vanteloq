"use client";
import { useEffect, useState } from "react";
export type Appearance = "system" | "light" | "dark";
const KEY = "vanteloq.appearance";
export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>("system");
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystem = () => setSystemDark(mq.matches);
    syncSystem();
    mq.addEventListener("change", syncSystem);
    try { const saved = window.localStorage.getItem(KEY); if (saved === "dark" || saved === "light" || saved === "system") setAppearance(saved); } catch {}
    return () => mq.removeEventListener("change", syncSystem);
  }, []);
  function changeAppearance(value: Appearance) {
    setAppearance(value);
    try { window.localStorage.setItem(KEY, value); } catch {}
  }
  return { appearance, changeAppearance, resolved: appearance === "system" ? (systemDark ? "dark" : "light") : appearance };
}
export function AppearanceSelect({value,onChange,compact=false}:{value:Appearance;onChange:(value:Appearance)=>void;compact?:boolean}) {
  return <div className="appearance-control"><label htmlFor={compact?"appearance-quick":"appearance-settings"}>Appearance</label><select id={compact?"appearance-quick":"appearance-settings"} value={value} onChange={event=>onChange(event.target.value as Appearance)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div>;
}
