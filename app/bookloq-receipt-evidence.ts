type EvidenceFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const evidenceTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

/** Use the authenticated document endpoint so tenant, download and scan checks still apply. */
export async function loadReceiptEvidence(fetcher: EvidenceFetcher, id: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetcher(`/api/v1/documents?id=${encodeURIComponent(id)}`, {
    headers: { Accept: "application/pdf,image/jpeg,image/png,image/webp" }, signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "The original receipt could not be opened. No match was saved.");
  }
  const contentType = (response.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (!evidenceTypes.has(contentType)) throw new Error("This receipt format cannot be previewed. Review the original in Files before matching it.");
  const blob = await response.blob();
  signal.throwIfAborted();
  if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error("The original receipt is empty or exceeds the supported preview size.");
  return blob.type === contentType ? blob : new Blob([blob], { type: contentType });
}
