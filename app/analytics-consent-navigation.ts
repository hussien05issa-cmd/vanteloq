export const CONSENT_STORAGE_KEY = "vanteloq:cookie-consent:v1";
export function validConsentChoice(value: unknown): "analytics" | "essential" | null {
  return value === "analytics" || value === "essential" ? value : null;
}

// This only suppresses an initial banner for a valid saved choice. Analytics
// still requires hydration, public-page checks and explicit consent below.
export const CONSENT_PRESENTATION_BOOTSTRAP = `(function () { try {
  var consent = localStorage.getItem(${JSON.stringify(CONSENT_STORAGE_KEY)});
  if (consent === "analytics" || consent === "essential") document.documentElement.dataset.analyticsConsentSaved = "true";
} catch (_) {} })();`;

export function createCookieNoticeNavigation(closePanel: () => void) {
  return {
    href: "/cookies" as const,
    onClick: closePanel,
  };
}

export function shouldShowConsentPanel(
  pathname: string,
  choice: "analytics" | "essential" | null | undefined,
  settingsOpen: boolean,
) {
  if (settingsOpen) return true;
  if (pathname === "/cookies") return false;
  return choice === null;
}
