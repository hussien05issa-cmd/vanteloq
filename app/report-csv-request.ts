type CsvFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ReportCsvRequestError extends Error {
  constructor(message: string, public status: number | null = null) {
    super(message);
    this.name = "ReportCsvRequestError";
  }
}

/** Read only, with no retries. The deadline covers session lookup, fetch and
 * the entire response body even when an upstream promise ignores cancellation.
 * Callers own the scope signal and must check it before initiating a download. */
export async function reportCsvRequest(fetcher: CsvFetcher, path: string, init: Pick<RequestInit, "signal" | "headers"> = {}, timeoutMs = 30_000): Promise<Blob> {
  const controller = new AbortController();
  const cancel = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener("abort", cancel, { once: true });
  if (init.signal?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new DOMException("CSV download timed out", "TimeoutError")), timeoutMs);
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    if (controller.signal.aborted) onAbort();
  });
  try {
    return await Promise.race([deadline, (async () => {
      controller.signal.throwIfAborted();
      const headers = new Headers(init.headers);
      headers.set("Accept", "text/csv");
      const response = await fetcher(path, { method: "GET", headers, cache: "no-store", signal: controller.signal });
      controller.signal.throwIfAborted();
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: unknown } } | null;
        throw new ReportCsvRequestError(typeof body?.error?.message === "string" && body.error.message.trim()
          ? body.error.message : "The report could not be exported. Check your access and try again.", response.status);
      }
      if (!/^text\/csv(?:\s*;|\s*$)/i.test(response.headers.get("content-type") ?? "")) {
        void response.body?.cancel().catch(() => {});
        throw new ReportCsvRequestError("The export did not return a CSV report. Please try again.", response.status);
      }
      const blob = await response.blob();
      controller.signal.throwIfAborted();
      return blob;
    })()]);
  } catch (error) {
    if (init.signal?.aborted) throw init.signal.reason;
    if (controller.signal.aborted) throw new ReportCsvRequestError("The CSV download is taking longer than expected. Try again.");
    if (error instanceof TypeError) throw new ReportCsvRequestError("The report could not be reached. Check your connection and try again.");
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", cancel);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  }
}
