"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createCookieNoticeNavigation, shouldShowConsentPanel } from "./analytics-consent-navigation";
import ProductBrandLogo from "./product-brand-logo";
import { useModalFocus } from "./use-modal-focus";

type ConsentChoice = "analytics" | "essential";
type GtagCommand = [string, ...unknown[]];

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: GtagCommand) => void;
    __vanteloqAnalyticsConfigured?: boolean;
    __vanteloqAnalyticsReady?: boolean;
  }
}

const PUBLIC_GOOGLE_ANALYTICS_ID = "G-RVY9BP00R2";
const ANALYTICS_ID =
  process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID?.trim() || PUBLIC_GOOGLE_ANALYTICS_ID;
const ANALYTICS_ID_PATTERN = /^G-[A-Z0-9]+$/;
const CONSENT_STORAGE_KEY = "vanteloq:cookie-consent:v1";
const SCRIPT_ID = "vanteloq-google-analytics";
const READY_EVENT = "vanteloq:analytics-ready";
const PUBLIC_MEASUREMENT_PATHS = new Set(["/", "/demo", "/help", "/pricing", "/contact", "/custom-plan", "/cookies", "/data-processing", "/legal", "/privacy", "/subprocessors", "/terms"]);
const PUBLIC_EVENTS = new Set(["demo_view", "demo_engaged", "signup_start", "plan_selected", "pricing_view", "compatibility_checked", "inquiry_sent"]);

function runGtag(...args: GtagCommand) {
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = window.gtag ?? ((...command: GtagCommand) => window.dataLayer?.push(command));
  window.gtag(...args);
}

function setAnalyticsDisabled(disabled: boolean) {
  (window as unknown as Record<string, unknown>)[`ga-disable-${ANALYTICS_ID}`] = disabled;
}

function clearAnalyticsCookies() {
  for (const item of document.cookie.split(";")) {
    const name = item.split("=")[0]?.trim();
    if (!name || (name !== "_ga" && !name.startsWith("_ga_"))) continue;
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
    document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.vanteloq.com; SameSite=Lax; Secure`;
  }
}

function configureAnalytics() {
  if (window.__vanteloqAnalyticsConfigured) return;
  runGtag("js", new Date());
  runGtag("config", ANALYTICS_ID, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_flags: "SameSite=Lax;Secure",
    page_location: `${window.location.origin}${window.location.pathname}`,
    page_path: window.location.pathname,
  });
  window.__vanteloqAnalyticsConfigured = true;
}

function isPublicMeasurementPage(pathname: string) {
  const isPublicPath = PUBLIC_MEASUREMENT_PATHS.has(pathname) || pathname === "/resources" || pathname.startsWith("/resources/") || pathname.startsWith("/features/");
  return isPublicPath && window.location.search === "";
}

function markAnalyticsReady() {
  if (window.__vanteloqAnalyticsReady) return;
  configureAnalytics();
  window.__vanteloqAnalyticsReady = true;
  window.dispatchEvent(new Event(READY_EVENT));
}

function loadAnalytics() {
  setAnalyticsDisabled(false);
  runGtag("consent", "update", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });

  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    if (!window.__vanteloqAnalyticsReady) existing.addEventListener("load", markAnalyticsReady, { once: true });
    return;
  }

  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ANALYTICS_ID)}`;
  script.referrerPolicy = "strict-origin-when-cross-origin";
  script.addEventListener("load", markAnalyticsReady, { once: true });
  document.head.append(script);
}

function stopAnalytics() {
  runGtag("consent", "update", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  setAnalyticsDisabled(true);
  clearAnalyticsCookies();
}

function readSavedChoice(): ConsentChoice | null {
  try {
    const saved = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    return saved === "analytics" || saved === "essential" ? saved : null;
  } catch {
    return null;
  }
}

function saveChoice(choice: ConsentChoice) {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    // The active choice still applies for this page when browser storage is blocked.
  }
}

const subscribeToHydration = () => () => undefined;
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

export function GoogleAnalyticsConsent() {
  const pathname = usePathname();
  const hydrated = useSyncExternalStore(subscribeToHydration, getClientHydrationSnapshot, getServerHydrationSnapshot);
  const [choiceOverride, setChoiceOverride] = useState<ConsentChoice | null>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const storedChoice = hydrated ? readSavedChoice() : undefined;
  const choice = choiceOverride === undefined ? storedChoice : choiceOverride;
  const panelOpen = hydrated && shouldShowConsentPanel(pathname, choice, settingsOpen);
  const configured = ANALYTICS_ID_PATTERN.test(ANALYTICS_ID);

  const applyChoice = useCallback((nextChoice: ConsentChoice) => {
    saveChoice(nextChoice);
    setChoiceOverride(nextChoice);
    setSettingsOpen(false);
    if (nextChoice === "essential") stopAnalytics();
  }, []);

  const dismissPanel = useCallback(() => {
    if (choice === null) applyChoice("essential");
    else setSettingsOpen(false);
  }, [applyChoice, choice]);

  useModalFocus(panelRef, configured && panelOpen, dismissPanel);

  useEffect(() => {
    if (!configured || choice === undefined) return;
    if (choice === "essential") {
      stopAnalytics();
      return;
    }
    if (choice !== "analytics" || !pathname) return;
    if (!isPublicMeasurementPage(pathname)) {
      stopAnalytics();
      return;
    }

    setAnalyticsDisabled(false);
    let pageViewSent = false;
    const sendPageView = () => {
      if (pageViewSent) return;
      pageViewSent = true;
      runGtag("event", "page_view", {
        page_location: `${window.location.origin}${pathname}`,
        page_path: pathname,
      });
    };
    window.addEventListener(READY_EVENT, sendPageView);
    if (window.__vanteloqAnalyticsReady) sendPageView();
    else loadAnalytics();
    return () => window.removeEventListener(READY_EVENT, sendPageView);
  }, [choice, configured, pathname]);

  useEffect(() => {
    if (!configured || choice !== "analytics" || !pathname || !isPublicMeasurementPage(pathname)) return;
    const measure = (event: Event) => {
      if (!window.__vanteloqAnalyticsReady || !(event.target instanceof Element)) return;
      const control = event.target.closest<HTMLElement>("[data-public-event]");
      if (!control?.closest(".public-site")) return;
      const name = control.dataset.publicEvent;
      if (!name || !PUBLIC_EVENTS.has(name)) return;
      if (event.type === "click" && control.matches("select,input")) return;
      // Fixed event vocabulary only. No input values, account data or URL queries.
      runGtag("event", name, { page_location: `${window.location.origin}${pathname}`, page_path: pathname });
    };
    const confirmed = (event: Event) => {
      if (!window.__vanteloqAnalyticsReady || !(event instanceof CustomEvent) || event.detail !== "inquiry_sent") return;
      runGtag("event", "inquiry_sent", { page_location: `${window.location.origin}${pathname}`, page_path: pathname });
    };
    document.addEventListener("click", measure);
    document.addEventListener("change", measure);
    window.addEventListener("vanteloq:public-conversion", confirmed);
    return () => { document.removeEventListener("click", measure); document.removeEventListener("change", measure); window.removeEventListener("vanteloq:public-conversion", confirmed); };
  }, [choice, configured, pathname]);

  if (!configured || choice === undefined) return null;

  const cookieNoticeNavigation = createCookieNoticeNavigation(() => setSettingsOpen(false));

  return (
    <>
      {panelOpen && (
        <section ref={panelRef} className="analytics-consent" role="dialog" aria-modal="true" aria-labelledby="analytics-consent-title" aria-describedby="analytics-consent-copy" tabIndex={-1}>
          <ProductBrandLogo product="vanteloq" priority className="analytics-consent-brand" />
          <div className="analytics-consent-copy">
            <span>PRIVACY CONTROLS</span>
            <h2 id="analytics-consent-title">Your privacy choices</h2>
            <p id="analytics-consent-copy">Optional Google Analytics helps us improve public pages. Account details, form entries, workspace records and URL query text are excluded. Advertising features stay off. Essential only gives you the same access.</p>
            <Link {...cookieNoticeNavigation}>Read the Cookie Notice</Link>
          </div>
          <div className="analytics-consent-actions">
            <button type="button" onClick={() => applyChoice("essential")}>Essential only</button>
            <button type="button" className="primary" onClick={() => applyChoice("analytics")}>Allow analytics</button>
          </div>
        </section>
      )}
      {!panelOpen && (
        <button type="button" className="analytics-settings-button" onClick={() => setSettingsOpen(true)} aria-label="Open cookie settings">
          Cookie Settings
        </button>
      )}
    </>
  );
}
