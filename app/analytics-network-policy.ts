// A loaded analytics SDK can retain queued events and native transport handles.
// An additional browser CSP blocks those transports without wrapping fetch/XHR
// or affecting the site's essential service endpoints. CSP cannot be relaxed in
// the same document, so a later opt-in starts a fresh document.
export const ESSENTIAL_ANALYTICS_POLICY_ID = "vanteloq-essential-network-policy";
export const ESSENTIAL_ANALYTICS_NETWORK_POLICY = "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com https://api.pwnedpasswords.com https://*.plaid.com; img-src 'self' data: blob:";

export function blockOptionalAnalyticsNetwork() {
  if (document.getElementById(ESSENTIAL_ANALYTICS_POLICY_ID)) return;
  const policy = document.createElement("meta");
  policy.id = ESSENTIAL_ANALYTICS_POLICY_ID;
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = ESSENTIAL_ANALYTICS_NETWORK_POLICY;
  document.head.append(policy);
}

export function optionalAnalyticsNetworkBlocked() {
  return Boolean(document.getElementById(ESSENTIAL_ANALYTICS_POLICY_ID));
}
