export const CANONICAL_APP_ORIGIN = "https://vanteloq.com";
export const LEGACY_APP_HOSTNAME = "vanteloq.hussien05issa.chatgpt.site";

export function canonicalAuthUrl(path = "/"): string {
  return new URL(path, `${CANONICAL_APP_ORIGIN}/`).toString();
}

export function canonicalLocation(current: Location): string | null {
  if (current.hostname.toLowerCase() !== LEGACY_APP_HOSTNAME) return null;
  const destination = new URL(CANONICAL_APP_ORIGIN);
  destination.pathname = current.pathname;
  destination.search = current.search;
  destination.hash = current.hash;
  return destination.toString();
}
