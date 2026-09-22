/** Supplemental application guard. The hosting edge must also reject legacy handshakes. */
export function rejectLegacyTls(request: Request): Response | null {
  // Read platform metadata only. Request headers cannot establish the TLS version.
  const version = (request as Request & { cf?: { tlsVersion?: unknown } }).cf?.tlsVersion;
  if (version !== "TLSv1" && version !== "TLSv1.0" && version !== "TLSv1.1") return null;
  return new Response("Your connection needs an update. Use a current browser with TLS 1.2 or newer to access Vanteloq.", {
    status: 403,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}

const CLOUDFLARE_CROSS_ZONE_WORKER_IP = "2a06:98c0:3600::103";
const TRUSTED_TLS_EDGE_ZONES = new Set(["vanteloq.com", "hussien05issa.workers.dev"]);
const CLIENT_IP_PATTERN = /^[0-9a-f:.]{3,64}$/i;

/**
 * Identifies the narrow Cloudflare-to-Sites hop used by Vanteloq's TLS edge.
 * Cloudflare overwrites CF-Connecting-IP with this reserved address for
 * cross-zone Worker subrequests and adds CF-Worker itself.
 */
export function isTrustedTlsEdgeProxy(request: Request): boolean {
  const workerZone = request.headers.get("cf-worker")?.trim().toLowerCase() ?? "";
  return request.headers.get("x-vanteloq-edge-proxy") === "1"
    && request.headers.get("cf-connecting-ip")?.trim().toLowerCase() === CLOUDFLARE_CROSS_ZONE_WORKER_IP
    && TRUSTED_TLS_EDGE_ZONES.has(workerZone);
}

export function trustedTlsEdgeClientIp(request: Request): string | null {
  if (!isTrustedTlsEdgeProxy(request)) return null;
  const candidate = request.headers.get("x-vanteloq-client-ip")?.trim() ?? "";
  return CLIENT_IP_PATTERN.test(candidate) ? candidate : null;
}
