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
