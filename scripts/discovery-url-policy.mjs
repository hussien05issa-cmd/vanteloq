// This check is intentionally separate from submission so private-route guards
// can be verified without making requests to a search engine.
export function isEligibleDiscoveryUrl(value, expectedOrigin = "https://vanteloq.com") {
  try {
    const url = new URL(value);
    const path = decodeURIComponent(url.pathname);
    if (url.origin !== expectedOrigin || url.username || url.password || url.search || url.hash) return false;
    if (/[\\?#]/.test(path)) return false;

    // /workspace is a public product overview. Its descendants can contain
    // private work, so do not relax the guard for that entire route family.
    if (path === "/workspace") return true;
    return !/^\/(?:api|workspace|datstudio|account|auth|admin|signin|signup|login|logout|email|privacy-requests)(?:\/|$)/i.test(path);
  } catch {
    return false;
  }
}

export function selectDiscoveryUrls(sitemapUrls, requestedPaths = [], origin = "https://vanteloq.com") {
  const urls = [...new Set(sitemapUrls)];
  if (!urls.length || urls.length > 10_000 || urls.some(url => !isEligibleDiscoveryUrl(url, origin))) {
    throw new Error("Sitemap contains an ineligible discovery URL or invalid URL count.");
  }
  if (!requestedPaths.length) return urls;

  return [...new Set(requestedPaths.map(path => {
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Use a canonical public path for --path.");
    const url = new URL(path, origin).href;
    if (!isEligibleDiscoveryUrl(url, origin) || !urls.includes(url)) {
      throw new Error("Requested discovery path must be an eligible URL in the deployed sitemap.");
    }
    return url;
  }))];
}
