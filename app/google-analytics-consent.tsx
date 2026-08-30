"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createCookieNoticeNavigation } from "./analytics-consent-navigation";
import ProductBrandLogo from "./product-brand-logo";

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
const PUBLIC_MEASUREMENT_PATHS = new Set(["/", "/cookies", "/data-processing", "/legal", "/privacy", "/subprocessors", "/terms"]);

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
  const isPublicPath = PUBLIC_MEASUREMENT_PATHS.has(pathname) || pathname === "/resources" || pathname.startsWith("/resources/");
  return isPublicPath && window.location.search === "";
}

function markAnalyticsReady() {
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
    if (window.__vanteloqAnalyticsReady) markAnalyticsReady();
    else existing.addEventListener("load", markAnalyticsReady, { once: true });
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

export function GoogleAnalyticsConsent() {
  const pathname = usePathname();
  const [choice, setChoice] = useState<ConsentChoice | null | undefined>(undefined);
  const [panelOpen, setPanelOpen] = useState(false);
  const [analyticsReady, setAnalyticsReady] = useState(false);
  const configured = ANALYTICS_ID_PATTERN.test(ANALYTICS_ID);

  useEffect(() => {
    if (!configured) return;
    const saved = readSavedChoice();
    setChoice(saved);
    setPanelOpen(saved === null);

    const handleReady = () => setAnalyticsReady(true);
    window.addEventListener(READY_EVENT, handleReady);
    if (saved === "essential") stopAnalytics();
    return () => window.removeEventListener(READY_EVENT, handleReady);
  }, [configured]);

  useEffect(() => {
    if (!configured || choice !== "analytics" || !pathname) return;
    if (!isPublicMeasurementPage(pathname)) {
      stopAnalytics();
      setAnalyticsReady(false);
      return;
    }
    if (!analyticsReady) {
      loadAnalytics();
      return;
    }
    runGtag("event", "page_view", {
      page_location: `${window.location.origin}${pathname}`,
      page_path: pathname,
    });
  }, [analyticsReady, choice, configured, pathname]);

  if (!configured || choice === undefined) return null;

  const applyChoice = (nextChoice: ConsentChoice) => {
    saveChoice(nextChoice);
    setChoice(nextChoice);
    setPanelOpen(false);
    if (nextChoice === "essential") stopAnalytics();
  };

  const cookieNoticeNavigation = createCookieNoticeNavigation(() => setPanelOpen(false));

  return (
    <>
      {panelOpen && (
        <section className="analytics-consent" role="dialog" aria-labelledby="analytics-consent-title" aria-describedby="analytics-consent-copy">
          <ProductBrandLogo product="vanteloq" priority className="analytics-consent-brand" />
          <div className="analytics-consent-copy">
            <span>PRIVACY CONTROLS</span>
            <h2 id="analytics-consent-title">Help us improve Vanteloq with optional analytics.</h2>
            <p id="analytics-consent-copy">With your permission, Google Analytics helps us understand how visitors use Vanteloq’s public pages so we can improve navigation and content. We do not send account information, form entries, email addresses, telephone numbers, workspace records, or URL query text. Advertising features remain off, and choosing Essential only will not limit Vanteloq.</p>
            <Link {...cookieNoticeNavigation}>Read the Cookie Notice</Link>
          </div>
          <div className="analytics-consent-actions">
            <button type="button" onClick={() => applyChoice("essential")}>Essential only</button>
            <button type="button" className="primary" onClick={() => applyChoice("analytics")}>Allow analytics</button>
          </div>
        </section>
      )}
      {!panelOpen && (
        <button type="button" className="analytics-settings-button" onClick={() => setPanelOpen(true)} aria-label="Open cookie settings">
          Cookie settings
        </button>
      )}
    </>
  );
}
