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
