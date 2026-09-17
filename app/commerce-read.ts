type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export const COMMERCE_READ_TIMEOUT_MS = 120_000;
export type CommerceReportState<T> = { scope: string; data: T | null; error: string; loading: boolean };
export class CommerceReadError extends Error {
  constructor(message: string, public status: number | null = null) { super(message); this.name = "CommerceReadError"; }
}

/** Read only. The deadline includes session lookup, network and JSON consumption. */
export async function readCommerceJson<T>(fetcher: Fetcher, path: string, signal: AbortSignal, timeoutMs = COMMERCE_READ_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  let responseStatus: number | null = null;
  const unavailable = "This report could not be loaded. Check your connection and try again.";
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  let abortListener: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    abortListener = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", abortListener, { once: true });
    if (controller.signal.aborted) abortListener();
  });
  try {
    return await Promise.race([deadline, (async () => {
      controller.signal.throwIfAborted();
      const response = await fetcher(path, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal });
      responseStatus = response.status;
      const body = await response.json().catch(() => { throw new CommerceReadError(unavailable, response.status); });
      if (!response.ok) throw new CommerceReadError(typeof body?.error?.message === "string" ? body.error.message : unavailable, response.status);
      return body as T;
    })()]);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (controller.signal.aborted) throw new CommerceReadError("This report is taking longer than expected. Try a shorter date range or try again.", responseStatus);
    if (error instanceof TypeError) throw new CommerceReadError(unavailable, responseStatus);
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    if (abortListener) controller.signal.removeEventListener("abort", abortListener);
  }
}

/** One active read per view. Cancelled or superseded responses cannot restore old records. */
export function createCommerceReportLoader<T>(fetcher: Fetcher, update: (state: CommerceReportState<T>) => void, timeoutMs = COMMERCE_READ_TIMEOUT_MS) {
  let active: AbortController | null = null;
  return {
    async load(scope: string, relevant: () => boolean = () => true) {
      if (!relevant()) return;
      active?.abort();
      const controller = new AbortController(); active = controller;
      const current = () => active === controller && !controller.signal.aborted && relevant();
      update({ scope, data: null, error: "", loading: true });
      try {
        const data = await readCommerceJson<T>(fetcher, scope, controller.signal, timeoutMs);
        if (current()) update({ scope, data, error: "", loading: false });
      } catch (error) {
        if (current()) update({ scope, data: null, error: error instanceof Error ? error.message : "This report could not be loaded. Try again.", loading: false });
      }
    },
    cancel() { active?.abort(); active = null; },
  };
}
