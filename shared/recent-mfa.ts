/** Call only with claims from an independently verified authentication token. */
export function latestMfaTime(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null;
  const methods = new Set(["totp", "mfa/totp", "mfa/phone", "mfa/webauthn"]);
  const timestamps = amr.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return typeof row.method === "string" && methods.has(row.method)
      && typeof row.timestamp === "number" && Number.isSafeInteger(row.timestamp) && row.timestamp > 0
      ? [row.timestamp] : [];
  });
  return timestamps.length ? Math.max(...timestamps) : null;
}

export function isRecentMfa(timestamp: number | null | undefined, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return typeof timestamp === "number" && Number.isSafeInteger(timestamp)
    && timestamp <= nowSeconds + 30 && nowSeconds - timestamp <= 300;
}
