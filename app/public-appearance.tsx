"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import "./public-appearance.css";

export type PublicAppearanceSnapshot = Readonly<{ appearance: "system"; theme: "dark" | "light" }>;
export type PublicAppearanceEnvironment = {
  systemDark: () => boolean | null;
  subscribeSystem: (listener: () => void) => () => void;
};
const SERVER_SNAPSHOT: PublicAppearanceSnapshot = Object.freeze({ appearance: "system", theme: "dark" });
const noop = () => {};

/** Public pages follow the device without reading or changing workspace preferences. */
export function createPublicAppearanceStore(environment: PublicAppearanceEnvironment) {
  let snapshot = SERVER_SNAPSHOT;
  let disconnect: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const refresh = () => {
    let theme: "dark" | "light" = "dark";
    try { if (environment.systemDark() === false) theme = "light"; } catch { /* Keep a readable fallback. */ }
    if (snapshot.theme === theme) return;
    snapshot = Object.freeze({ appearance: "system", theme });
    for (const listener of listeners) listener();
  };
  refresh();
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => SERVER_SNAPSHOT,
    subscribe(listener: () => void) {
      const notify = () => listener();
      listeners.add(notify);
      if (listeners.size === 1) {
        try { disconnect = environment.subscribeSystem(refresh); } catch { disconnect = noop; }
        refresh();
      }
      return () => {
        listeners.delete(notify);
        if (!listeners.size) {
          try { disconnect?.(); } catch { /* Browser teardown must not break navigation. */ }
          disconnect = undefined;
        }
      };
    },
  };
}

export type PublicAppearanceStore = ReturnType<typeof createPublicAppearanceStore>;
let browserStore: PublicAppearanceStore | undefined;
function getBrowserStore() {
  if (typeof window === "undefined") return undefined;
  if (!browserStore) {
    let query: MediaQueryList | undefined;
    try { query = window.matchMedia?.("(prefers-color-scheme: dark)"); } catch { /* Use the server fallback. */ }
    browserStore = createPublicAppearanceStore({
      systemDark: () => query?.matches ?? null,
      subscribeSystem: listener => {
        if (!query) return noop;
        if (query.addEventListener) { query.addEventListener("change", listener); return () => query?.removeEventListener("change", listener); }
        query.addListener(listener);
        return () => query?.removeListener(listener);
      },
    });
  }
  return browserStore;
}
const subscribe = (listener: () => void) => getBrowserStore()?.subscribe(listener) ?? noop;
const getSnapshot = () => getBrowserStore()?.getSnapshot() ?? SERVER_SNAPSHOT;
const getServerSnapshot = () => SERVER_SNAPSHOT;

export function usePublicAppearance(store?: PublicAppearanceStore) {
  return useSyncExternalStore(store?.subscribe ?? subscribe, store?.getSnapshot ?? getSnapshot, store?.getServerSnapshot ?? getServerSnapshot);
}

/** Public previews reuse the workspace panel palette, with the device theme. */
export function PublicAppearanceBoundary({ children, store }: { children: ReactNode; store?: PublicAppearanceStore }) {
  const { appearance, theme } = usePublicAppearance(store);
  return <div className="workspace-theme-scope" data-workspace-theme={theme} data-workspace-appearance={appearance} data-public-appearance={appearance}>{children}</div>;
}
