"use client";

import { useId, useSyncExternalStore, type ReactNode } from "react";

export type WorkspaceAppearance = "dark" | "light" | "system";
export const WORKSPACE_APPEARANCE_KEY = "vanteloq.workspace.appearance.v1";
const STORAGE_NOTICE = "Appearance applies to this open page. Your browser could not load or save the device preference.";
const SYSTEM_NOTICE = "Device appearance is unavailable. System uses Dark until it is available.";
export type WorkspaceAppearanceSnapshot = Readonly<{
  appearance: WorkspaceAppearance;
  theme: "dark" | "light";
  storageNotice: string;
  systemNotice: string;
}>;
export type WorkspaceAppearanceEnvironment = {
  read: () => string | null;
  write: (value: WorkspaceAppearance) => void;
  systemDark: () => boolean | null;
  subscribeSystem: (listener: () => void) => () => void;
  subscribeStorage: (listener: (value: string | null) => void) => () => void;
};
const SERVER_SNAPSHOT: WorkspaceAppearanceSnapshot = Object.freeze({ appearance: "dark", theme: "dark", storageNotice: "", systemNotice: "" });
const noop = () => {};

export function normalizeWorkspaceAppearance(value: unknown): WorkspaceAppearance {
  return value === "light" || value === "system" ? value : "dark";
}

/** One device preference, shared by all mounted workspaces and portal boundaries. */
export function createWorkspaceAppearanceStore(environment: WorkspaceAppearanceEnvironment) {
  let appearance: WorkspaceAppearance = "dark";
  let deviceDark: boolean | null = null;
  let storageNotice = "";
  let unsavedSelection = false;
  let snapshot = SERVER_SNAPSHOT;
  let disconnect: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const refreshSystem = () => {
    try { const value = environment.systemDark(); deviceDark = typeof value === "boolean" ? value : null; }
    catch { deviceDark = null; }
  };
  const publish = () => {
    const theme = appearance === "system" ? deviceDark === false ? "light" : "dark" : appearance;
    const systemNotice = appearance === "system" && deviceDark === null ? SYSTEM_NOTICE : "";
    if (snapshot.appearance === appearance && snapshot.theme === theme && snapshot.storageNotice === storageNotice && snapshot.systemNotice === systemNotice) return;
    snapshot = Object.freeze({ appearance, theme, storageNotice, systemNotice });
    for (const listener of listeners) listener();
  };
  const refresh = () => {
    refreshSystem();
    try {
      const saved = environment.read();
      // A blocked write must not restore the older saved value on remount.
      if (!unsavedSelection) { appearance = normalizeWorkspaceAppearance(saved); storageNotice = ""; }
    } catch { storageNotice = STORAGE_NOTICE; }
    publish();
  };
  const safelySubscribe = (subscribe: () => () => void) => {
    try { return subscribe(); } catch { return noop; }
  };
  const safelyDisconnect = (remove: () => void) => { try { remove(); } catch { /* Browser teardown must not break unmount. */ } };
  refresh();
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => SERVER_SNAPSHOT,
    subscribe(listener: () => void) {
      // Each subscription has its own identity, including Strict Mode remounts.
      const notify = () => listener();
      listeners.add(notify);
      if (listeners.size === 1) {
        const removeSystem = safelySubscribe(() => environment.subscribeSystem(() => { refreshSystem(); publish(); }));
        const removeStorage = safelySubscribe(() => environment.subscribeStorage(value => {
          appearance = normalizeWorkspaceAppearance(value);
          unsavedSelection = false;
          storageNotice = "";
          refreshSystem();
          publish();
        }));
        disconnect = () => { safelyDisconnect(removeSystem); safelyDisconnect(removeStorage); };
        refresh();
      }
      return () => {
        listeners.delete(notify);
        if (!listeners.size) { disconnect?.(); disconnect = undefined; }
      };
    },
    choose(value: WorkspaceAppearance) {
      appearance = normalizeWorkspaceAppearance(value);
      refreshSystem();
      try { environment.write(appearance); unsavedSelection = false; storageNotice = ""; }
      catch { unsavedSelection = true; storageNotice = STORAGE_NOTICE; }
      publish();
    },
  };
}

export type WorkspaceAppearanceStore = ReturnType<typeof createWorkspaceAppearanceStore>;
let browserStore: WorkspaceAppearanceStore | undefined;
function getBrowserStore() {
  if (typeof window === "undefined") return undefined;
  if (!browserStore) {
    let query: MediaQueryList | undefined;
    try { query = window.matchMedia?.("(prefers-color-scheme: dark)"); } catch { /* Dark remains available. */ }
    browserStore = createWorkspaceAppearanceStore({
      read: () => window.localStorage.getItem(WORKSPACE_APPEARANCE_KEY),
      write: value => window.localStorage.setItem(WORKSPACE_APPEARANCE_KEY, value),
      systemDark: () => query?.matches ?? null,
      subscribeSystem: listener => {
        if (!query) return noop;
        if (query.addEventListener) { query.addEventListener("change", listener); return () => query?.removeEventListener("change", listener); }
        query.addListener(listener);
        return () => query?.removeListener(listener);
      },
      subscribeStorage: listener => {
        const update = (event: StorageEvent) => {
          if (event.key !== WORKSPACE_APPEARANCE_KEY && event.key !== null) return;
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
const subscribe = (listener: () => void) => getBrowserStore()?.subscribe(listener) ?? noop;
const getSnapshot = () => getBrowserStore()?.getSnapshot() ?? SERVER_SNAPSHOT;
const getServerSnapshot = () => SERVER_SNAPSHOT;
const choose = (value: WorkspaceAppearance) => getBrowserStore()?.choose(value);

/** A deterministic dark SSR snapshot avoids a light first frame or hydration mismatch. */
export function useWorkspaceAppearance(store?: WorkspaceAppearanceStore) {
  const snapshot = useSyncExternalStore(store?.subscribe ?? subscribe, store?.getSnapshot ?? getSnapshot, getServerSnapshot);
  return { ...snapshot, choose: store?.choose ?? choose };
}

/** Wrap the content passed to createPortal; never set a theme on body or public pages. */
export function WorkspaceAppearanceBoundary({ children, store }: { children: ReactNode; store?: WorkspaceAppearanceStore }) {
  const { appearance, theme } = useWorkspaceAppearance(store);
  return <div className="workspace-theme-scope" data-workspace-theme={theme} data-workspace-appearance={appearance}>{children}</div>;
}

export function WorkspaceAppearanceControl({ store }: { store?: WorkspaceAppearanceStore }) {
  const appearance = useWorkspaceAppearance(store);
  const id = useId();
  return <section className="workspace-appearance-control" aria-labelledby={`${id}-heading`}>
    <div className="workspace-appearance-heading"><div><h3 id={`${id}-heading`}>Workspace appearance</h3><p>Choose how Vanteloq looks on this device.</p></div><span className="workspace-appearance-current">{appearance.theme === "dark" ? "Dark" : "Light"} active</span></div>
    <fieldset aria-describedby={`${id}-description`}><legend className="workspace-appearance-legend">Colour theme</legend><div className="workspace-appearance-choices">
      {([{ value: "dark", label: "Dark", description: "Navy surfaces. The default." }, { value: "light", label: "Light", description: "Bright, clear surfaces." }, { value: "system", label: "System", description: "Follow your device." }] as const).map(option => <label className="workspace-appearance-option" key={option.value} data-selected={appearance.appearance === option.value}>
        <input type="radio" name={`${id}-appearance`} value={option.value} checked={appearance.appearance === option.value} onChange={() => appearance.choose(option.value)}/><span className={`workspace-appearance-swatch workspace-appearance-swatch-${option.value}`} aria-hidden="true"><i/><i/><i/></span><span><strong>{option.label}</strong><small>{option.description}</small></span>
      </label>)}
    </div></fieldset>
    <p id={`${id}-description`} className="workspace-appearance-description">Saved in this browser for your workspaces, BookLoQ and Vanteloq AI. Your public website keeps its own appearance.</p>
    <div className="workspace-appearance-notice" role="status" aria-live="polite">{appearance.storageNotice && <p>{appearance.storageNotice}</p>}{appearance.systemNotice && <p>{appearance.systemNotice}</p>}</div>
  </section>;
}
