"use client";

import { useSyncExternalStore } from "react";

export type AdvisorAppearance = "system" | "light" | "dark";
export const AI_APPEARANCE_KEY = "vanteloq.ai.appearance.v1";
const STORAGE_NOTICE = "Appearance applies to this open page. Your browser could not save it.";
type AppearanceSnapshot = { appearance: AdvisorAppearance; theme: "light" | "dark"; storageNotice: string };
type AppearanceEnvironment = {
  read: () => string | null;
  write: (value: AdvisorAppearance) => void;
  systemDark: () => boolean;
  subscribeSystem: (listener: () => void) => () => void;
  subscribeStorage: (listener: (value: string | null) => void) => () => void;
};
const SERVER_SNAPSHOT: AppearanceSnapshot = { appearance: "system", theme: "light", storageNotice: "" };

export function normalizeAdvisorAppearance(value: unknown): AdvisorAppearance {
  return value === "light" || value === "dark" ? value : "system";
}

/** Cached snapshots keep React subscriptions stable; the environment owns browser I/O. */
export function createAdvisorAppearanceStore(environment: AppearanceEnvironment) {
  let appearance: AdvisorAppearance = "system";
  let systemDark = false;
  let storageNotice = "";
  let unsavedSelection = false;
  let snapshot = SERVER_SNAPSHOT;
  let disconnect: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = () => {
    const theme = appearance === "system" ? systemDark ? "dark" : "light" : appearance;
    if (snapshot.appearance === appearance && snapshot.theme === theme && snapshot.storageNotice === storageNotice) return;
    snapshot = { appearance, theme, storageNotice };
    for (const listener of listeners) listener();
  };
  const refresh = () => {
    systemDark = environment.systemDark();
    try {
      const stored = environment.read();
      // A failed write must not undo a choice when this component is reopened.
      if (!unsavedSelection) { appearance = normalizeAdvisorAppearance(stored); storageNotice = ""; }
    } catch { storageNotice = STORAGE_NOTICE; }
    publish();
  };
  refresh();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        const removeSystem = environment.subscribeSystem(() => { systemDark = environment.systemDark(); publish(); });
        const removeStorage = environment.subscribeStorage(value => {
          appearance = normalizeAdvisorAppearance(value);
          unsavedSelection = false;
          storageNotice = "";
          publish();
        });
        disconnect = () => { removeSystem(); removeStorage(); };
        refresh();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { disconnect?.(); disconnect = undefined; }
      };
    },
    choose(value: AdvisorAppearance) {
      appearance = normalizeAdvisorAppearance(value);
      try { environment.write(appearance); unsavedSelection = false; storageNotice = ""; }
      catch { unsavedSelection = true; storageNotice = STORAGE_NOTICE; }
      publish();
    },
  };
}

type AppearanceStore = ReturnType<typeof createAdvisorAppearanceStore>;
let browserStore: AppearanceStore | undefined;
function getBrowserStore() {
  if (typeof window === "undefined") return undefined;
  if (!browserStore) {
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : undefined;
    browserStore = createAdvisorAppearanceStore({
      read: () => window.localStorage.getItem(AI_APPEARANCE_KEY),
      write: value => window.localStorage.setItem(AI_APPEARANCE_KEY, value),
      systemDark: () => query?.matches ?? false,
      subscribeSystem: listener => {
        if (!query) return () => {};
        if (query.addEventListener) { query.addEventListener("change", listener); return () => query.removeEventListener("change", listener); }
        query.addListener(listener);
        return () => query.removeListener(listener);
      },
      subscribeStorage: listener => {
        const update = (event: StorageEvent) => {
          if (event.key !== AI_APPEARANCE_KEY && event.key !== null) return;
          try { if (event.storageArea && event.storageArea !== window.localStorage) return; }
          catch { return; }
          listener(event.key === null ? null : event.newValue);
        };
        window.addEventListener("storage", update);
        return () => window.removeEventListener("storage", update);
      },
    });
  }
  return browserStore;
}

const subscribe = (listener: () => void) => getBrowserStore()?.subscribe(listener) ?? (() => {});
const getSnapshot = () => getBrowserStore()?.getSnapshot() ?? SERVER_SNAPSHOT;
const getServerSnapshot = () => SERVER_SNAPSHOT;
const choose = (value: AdvisorAppearance) => getBrowserStore()?.choose(value);

/** Device appearance is independent of workspace data and AI response preferences. */
export function useAdvisorAppearance() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ...snapshot, choose };
}
