import { REPORT_NAMES, type MarketingReport, type ReportDataset, type ReportSource, type ReportView } from "../domain/marketing-reporting";

export type MarketingReportRequest = { locationId: string | null; selectionId: string; dataset: ReportDataset; view: ReportView; days: number };
export type MarketingReportSnapshot = { requestKey: string; status: "loading" | "ready" | "error"; report: MarketingReport | null; error: string };

export function marketingReportRequestKey(request: MarketingReportRequest) {
  return JSON.stringify([request.locationId, request.selectionId, request.dataset, request.view, request.days]);
}

export function marketingReportsUrl(locationId: string | null, request?: MarketingReportRequest) {
  const parameters = new URLSearchParams();
  if (locationId) parameters.set("location", locationId);
  if (request) {
    parameters.set("selectionId", request.selectionId);
    parameters.set("view", request.view);
    parameters.set("days", String(request.days));
  }
  return `/api/v1/marketing/reports${parameters.size ? `?${parameters}` : ""}`;
}

export async function readMarketingSources(fetcher: typeof fetch, locationId: string | null, signal: AbortSignal): Promise<ReportSource[]> {
  const response = await fetcher(marketingReportsUrl(locationId), { signal, cache: "no-store", headers: { Accept: "application/json" } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || "Marketing sources could not be loaded.");
  if (!Array.isArray(body.sources) || body.sources.some((source: ReportSource) => !source || typeof source.id !== "string" || typeof source.name !== "string" || !Object.hasOwn(REPORT_NAMES, source.dataset))) {
    throw new Error("The source list is incomplete. Reload sources to try again.");
  }
  return body.sources;
}

/** Only this exact authorized source may satisfy a read. The endpoint remains read-only. */
export async function readMarketingReport(fetcher: typeof fetch, request: MarketingReportRequest, signal: AbortSignal): Promise<MarketingReport> {
  const response = await fetcher(marketingReportsUrl(request.locationId, request), { signal, cache: "no-store", headers: { Accept: "application/json" } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || "This report could not be loaded.");
  if (body.source?.id !== request.selectionId || body.report?.dataset !== request.dataset || body.report?.view !== request.view
    || !Array.isArray(body.report?.columns) || !Array.isArray(body.report?.rows) || !body.report?.period) {
    throw new Error("The returned report does not match this source. Reload sources to try again.");
  }
  return body.report;
}

/** Also applied during render, before a location/source/period change can run effect cleanup. */
export function visibleMarketingReport(snapshot: MarketingReportSnapshot | null, request: MarketingReportRequest | null) {
  return request && snapshot?.requestKey === marketingReportRequestKey(request) ? snapshot : null;
}

export function createMarketingReportReader({ read, onChange }: {
  read: (request: MarketingReportRequest, signal: AbortSignal) => Promise<MarketingReport>;
  onChange: (snapshot: MarketingReportSnapshot | null) => void;
}) {
  let disposed = false;
  let pending: { key: string; controller: AbortController } | null = null;
  const cancel = () => { pending?.controller.abort(); pending = null; };
  return {
    async load(request: MarketingReportRequest) {
      if (disposed) return;
      const key = marketingReportRequestKey(request);
      if (pending?.key === key) return;
      cancel();
      const current = { key, controller: new AbortController() };
      pending = current;
      onChange({ requestKey: key, status: "loading", report: null, error: "" });
      try {
        const report = await read(request, current.controller.signal);
        if (!disposed && !current.controller.signal.aborted && pending === current) onChange({ requestKey: key, status: "ready", report, error: "" });
      } catch (caught) {
        if (!disposed && !current.controller.signal.aborted && pending === current) onChange({ requestKey: key, status: "error", report: null, error: caught instanceof Error ? caught.message : "This report could not be loaded." });
      } finally { if (pending === current) pending = null; }
    },
    clear() { cancel(); if (!disposed) onChange(null); },
    dispose() { disposed = true; cancel(); },
  };
}
