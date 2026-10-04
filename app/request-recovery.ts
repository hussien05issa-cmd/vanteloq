/** Preserve useful validation guidance while keeping proxy, database and stack diagnostics out of the interface. */
export function safeRequestMessage(message: unknown, fallback: string): string {
  if (typeof message !== "string" || !message.trim() || message.length > 600) return fallback;
  const text = message.trim();
  if (/^(?:The request could not be completed\.?|Internal server error\.?|Bad gateway\.?|Service unavailable\.?|Not found\.?)$/i.test(text)) return fallback;
  const technical = /<\/?(?:html|body|head|script)\b|<!doctype|\b(?:SQLITE_[A-Z_]+|D1_ERROR|TypeError|SyntaxError|ReferenceError|ChunkLoadError)\b|\bat\s+\S+\s*\([^)]*:\d+:\d+\)|\b(?:HTTP\s*)?[45]\d{2}\s*(?:error|not found|bad gateway|internal server error|service unavailable)|^(?:error\s*:?\s*)?[45]\d{2}$|unexpected token|failed to fetch|networkerror|load failed|[A-Z]:\\|file:\/\/|constraint failed|no such (?:table|column)/i;
  return technical.test(text) ? fallback : text;
}

export function requestRecoveryMessage(status: number, isWrite: boolean): string {
  if (status === 401) return "Your session needs to be refreshed. Sign in again to continue.";
  if (status === 403) return "This action is not available with your current access. Ask your workspace owner for help.";
  if (status === 404) return "This item is no longer available here. Refresh the list and choose it again.";
  if (status === 429) return "Please wait a moment, then try again.";
  return isWrite
    ? "We could not confirm the change. Check the saved records before trying again."
    : "This view could not load. Please try again. If the problem continues, contact support.";
}

/** Only failed responses are normalized. HTTP status, error code and request reference remain available to callers. */
export async function recoverApiResponse(response: Response, isWrite: boolean): Promise<Response> {
  if (response.ok || response.status < 400) return response;
  const fallback = requestRecoveryMessage(response.status, isWrite);
  const body: unknown = await response.clone().json().catch(() => null);
  const payload = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const error = payload.error && typeof payload.error === "object" && !Array.isArray(payload.error) ? payload.error as Record<string, unknown> : {};
  const message = safeRequestMessage(error.message, fallback);
  if (error.message === message) return response;
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  return new Response(JSON.stringify({ ...payload, error: { ...error, message } }), { status: response.status, statusText: response.statusText, headers });
}
