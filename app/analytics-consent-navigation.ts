export function createCookieNoticeNavigation(closePanel: () => void) {
  return {
    href: "/cookies" as const,
    onClick: closePanel,
  };
}
