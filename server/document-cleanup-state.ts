export type DocumentCleanupRetry = {
  version: 1;
  attempts: number;
  lastAttemptAt: number;
  nextAttemptAt?: number;
  lastStatus: "running" | "retrying" | "attention" | "complete";
  errorCode?: string;
  leaseOwner?: string;
  leaseUntil?: number;
};

export function cleanupRetryDelay(attempts: number) {
  return Math.min(24 * 60 * 60_000, 5 * 60_000 * 2 ** Math.min(9, Math.max(0, attempts - 1)));
}

export function matchesCleanupRetryLease(retry: DocumentCleanupRetry | undefined, lease: string) {
  return retry?.version === 1 && retry.leaseOwner === lease && (retry.leaseUntil ?? 0) > Date.now();
}

/** UI status contains no provider URL, file text, credential or source filename. */
export function documentCleanupRetrySummary(value: string, status: string) {
  let retry: DocumentCleanupRetry | undefined;
  try {
    const envelope = JSON.parse(value);
    retry = (status === "deletion_pending" ? envelope?.deletion : envelope?.processing)?.cleanupRetry;
  } catch { /* Legacy invalid envelopes need explicit review, not inferred deletion. */ }
  const valid = retry?.version === 1 && ["running", "retrying", "attention", "complete"].includes(retry.lastStatus);
  const state = valid ? retry!.lastStatus === "running" && (retry!.leaseUntil ?? 0) <= Date.now() ? "retrying" : retry!.lastStatus : null;
  const date = (time: number | undefined) => typeof time === "number" && Number.isSafeInteger(time) && time > 0 && time < 8_640_000_000_000_000 ? new Date(time).toISOString() : null;
  return {
    cleanupRetryStatus: state,
    cleanupLastAttemptAt: valid ? date(retry!.lastAttemptAt) : null,
    cleanupNextAttemptAt: valid && state !== "complete" ? date(retry!.nextAttemptAt) : null,
    cleanupRetryMessage: state === "running" ? "Automatic cleanup is in progress."
      : state === "retrying" ? "Automatic cleanup will retry."
      : state === "attention" ? "Automatic cleanup needs review. You can retry manually or contact support."
      : null,
  };
}
