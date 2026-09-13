export const SCHEDULED_POS_PROVIDERS = ["lightspeed-r", "lightspeed", "square", "clover", "shopify-pos", "shopify", "moneris", "stripe"] as const;
export type ScheduledPosProvider = typeof SCHEDULED_POS_PROVIDERS[number];
export function isScheduledPosProvider(value: string): value is ScheduledPosProvider {
  return (SCHEDULED_POS_PROVIDERS as readonly string[]).includes(value);
}
export function syncRetryDelay(failures: number) {
  return Math.min(3600, 60 * 2 ** Math.min(6, Math.max(0, failures - 1)));
}
export function syncHasMore(result: Record<string, unknown>) {
  return result.backfillComplete === false || result.hasMore === true;
}
export function shouldPauseSync(code: string) {
  return ["SYNC_AUTHORIZATION_WITHDRAWN", "INTEGRATION_NOT_CONNECTED", "INTEGRATION_CONNECTION_NOT_FOUND",
    "DELETION_IN_PROGRESS", "FEATURE_NOT_INCLUDED", "SUBSCRIPTION_REQUIRED", "SUBSCRIPTION_INACTIVE",
    "INTEGRATION_CONSENT_REQUIRED"].includes(code) || /(?:REAUTH|RECONNECT|TOKEN_REVOKED|TOKEN_INVALID|AUTHORIZATION_EXPIRED|NOT_CONNECTED)/.test(code);
}
export function nextSyncAt(now: number, result: Record<string, unknown>, intervalSeconds = 900) {
  return now + (result.coalesced === true || syncHasMore(result) ? 60 : intervalSeconds);
}
