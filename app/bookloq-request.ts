type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export class BookloqRequestError extends Error {
  constructor(message: string, public status: number | null = null) { super(message); this.name = "BookloqRequestError"; }
}
export const bookloqAccessDenied = (error: unknown) => error instanceof BookloqRequestError && [401, 402, 403].includes(error.status ?? 0);

/** No automatic retries: a lost write response does not prove the write failed. */
export async function bookloqRequest(fetcher: ApiFetch, path: string, init: RequestInit = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const isWrite = !["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase());
  const uncertain = "We could not confirm the change. Check the saved records before submitting again.";
  const unavailable = "BookLoQ could not be reached. Check your connection and try again.";
  const cancel = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener("abort", cancel, { once: true });
  if (init.signal?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    if (controller.signal.aborted) onAbort();
  });
  try {
    return await Promise.race([deadline, (async () => {
      controller.signal.throwIfAborted();
      const response = await fetcher(path, { ...init, signal: controller.signal });
      const body = await response.json().catch(() => { throw new BookloqRequestError(isWrite ? uncertain : unavailable, response.status); });
      if (!response.ok) throw new BookloqRequestError(body?.error?.message || (isWrite ? uncertain : unavailable), response.status);
      return body;
    })()]);
  } catch (error) {
    if (init.signal?.aborted) throw init.signal.reason;
    if (controller.signal.aborted) throw new BookloqRequestError(isWrite ? uncertain : "BookLoQ is taking longer than expected. Try again.");
    if (error instanceof TypeError) throw new BookloqRequestError(isWrite ? uncertain : unavailable);
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", cancel);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  }
}
