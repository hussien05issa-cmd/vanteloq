export type OperationalEvent = {
  id: string;
  eventType: "payment.settled" | "inventory.depleted" | "message.queued" | "message.sent" | "message.failed";
  aggregateType: "sale" | "inventory" | "message";
  aggregateId: string; sourceSystem: string; occurredAt: number; recordedAt: number;
  payload: { paymentId?: string; locationRef?: string; totalCents?: number; currency?: string; lineCount?: number };
};
export type OutboundMessage = {
  id: string; channel: "email"; recipient: string; subject: string;
  status: "held" | "queued" | "sending" | "sent" | "failed";
  attemptCount: number; createdAt: number; updatedAt: number;
};
type InventoryProjection = { locationRef: string; sku: string; name: string; projectedQuantity: number; reorderPoint: number; updatedAt: number };
export type OperationsFeed = { scopeFingerprint: string; cursor: number; events: OperationalEvent[]; messages: OutboundMessage[]; inventory: InventoryProjection[] };
export type CommunicationsSnapshot = {
  locationId: string | null; feed: OperationsFeed | null; refreshing: boolean;
  error: string; lastSuccessfulReadAt: number | null;
};
export const EMPTY_OPERATIONS_FEED: OperationsFeed = { scopeFingerprint: "", cursor: 0, events: [], messages: [], inventory: [] };

export class CommunicationsReadError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function readCommunicationsFeed(fetcher: typeof fetch, locationId: string | null, after: number, signal: AbortSignal, scopeFingerprint: string | null = null): Promise<OperationsFeed> {
  const parameters = new URLSearchParams({ after: String(after) });
  if (locationId) parameters.set("location", locationId);
  if (scopeFingerprint) parameters.set("scope", scopeFingerprint);
  const response = await fetcher(`/api/v1/operations?${parameters}`, { headers: { Accept: "application/json" }, signal });
  const body = await response.json().catch(() => null) as (OperationsFeed & { error?: { message?: string } }) | null;
  if (!response.ok) throw new CommunicationsReadError(body?.error?.message || "The communications feed is unavailable.", response.status);
  if (!body || !Number.isSafeInteger(body.cursor) || body.cursor < 0
    || typeof body.scopeFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(body.scopeFingerprint)
    || (body.scopeFingerprint === scopeFingerprint && body.cursor < after)
    || !Array.isArray(body.events) || !Array.isArray(body.messages) || !Array.isArray(body.inventory)) {
    throw new Error("The communications feed returned an incomplete response. Retry to check the records.");
  }
  return body;
}

/** Render-time scope fence: changing locations hides the previous snapshot before effects run. */
export function visibleCommunicationsSnapshot(snapshot: CommunicationsSnapshot | null, locationId: string | null): CommunicationsSnapshot {
  return snapshot?.locationId === locationId ? snapshot : { locationId, feed: null, refreshing: true, error: "", lastSuccessfulReadAt: null };
}

/** A single mounted location owns its cursor, polling timer and pending request. */
export function createCommunicationsFeed({ locationId, read, onChange, now, every }: {
  locationId: string | null;
  read: (after: number, signal: AbortSignal, scopeFingerprint: string | null) => Promise<OperationsFeed>;
  onChange: (snapshot: CommunicationsSnapshot) => void;
  now: () => number;
  every: (callback: () => void, milliseconds: number) => () => void;
}) {
  let disposed = false;
  let pending: AbortController | null = null;
  let state: CommunicationsSnapshot = { locationId, feed: null, refreshing: false, error: "", lastSuccessfulReadAt: null };
  const publish = (next: CommunicationsSnapshot) => { state = next; if (!disposed) onChange(next); };
  const refresh = async () => {
    if (disposed || pending) return;
    const request = new AbortController();
    pending = request;
    publish({ ...state, refreshing: true });
    try {
      const body = await read(state.feed?.cursor ?? 0, request.signal, state.feed?.scopeFingerprint ?? null);
      // Some transports finish parsing after abort. They must not publish or advance the cursor.
      if (disposed || request.signal.aborted) return;
      const previousEvents = state.feed?.scopeFingerprint === body.scopeFingerprint ? state.feed.events : [];
      const events = [...new Map([...previousEvents, ...body.events].map(event => [event.id, event])).values()].slice(-300);
      publish({ locationId, feed: { ...body, events }, refreshing: false, error: "", lastSuccessfulReadAt: now() });
    } catch (caught) {
      if (disposed || request.signal.aborted) return;
      const accessDenied = caught instanceof CommunicationsReadError && [401, 403].includes(caught.status);
      publish({ ...state, feed: accessDenied ? null : state.feed, refreshing: false,
        error: caught instanceof Error ? caught.message : "The communications feed is unavailable." });
    } finally { if (pending === request) pending = null; }
  };
  const stopTimer = every(() => { void refresh(); }, 8_000);
  return { locationId, refresh, dispose() {
    if (disposed) return;
    disposed = true; stopTimer(); pending?.abort(); pending = null;
  } };
}
