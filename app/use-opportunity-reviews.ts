"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./supabase-browser";
import type { OperatingDecision } from "../server/operating-system";
import type { OpportunityReview } from "../domain/opportunity-review";
import type { ReviewChange } from "./opportunity-review-panel";

export function useOpportunityReviews(locationId: string | null, period: { from: string; to: string } | null) {
  const [reviews, setReviews] = useState<OpportunityReview[]>([]);
  const [canReview, setCanReview] = useState(false), [historyAvailable, setHistoryAvailable] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const generation = useRef(0), pending = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const url = `/api/v1/opportunities${locationId ? `?location=${encodeURIComponent(locationId)}` : ""}`;
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const response = await apiFetch(url); const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Saved reviews could not be loaded.");
      if (current !== generation.current) return;
      setReviews(body.reviews); setCanReview(body.canReview); setHistoryAvailable(body.historyAvailable);
    } catch (error) { if (current === generation.current) { setReviews([]); setCanReview(false); setError(error instanceof Error ? error.message : "Saved reviews could not be loaded."); } }
    finally { if (current === generation.current) setLoading(false); }
  }, [url]);
  useEffect(() => {
    const requestGeneration = generation;
    let active = true;
    // The containing workspace is keyed by location, so no prior scope is
    // rendered during the initial asynchronous load.
    queueMicrotask(() => { if (active) void refresh(); });
    return () => { active = false; requestGeneration.current++; };
  }, [refresh]);
  const save = async (method: "POST" | "PATCH", value: object) => {
    if (pending.current) throw new Error("A review is already being saved.");
    pending.current = true; setBusy(true); setError("");
    const current = generation.current;
    const payload = JSON.stringify(value);
    if (!attempt.current || attempt.current.payload !== method + url + payload) attempt.current = { payload: method + url + payload, key: crypto.randomUUID() };
    try {
      const response = await apiFetch(url, { method, headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.key }, body: payload });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "The review was not saved.");
      if (!body.review) throw new Error("Refresh saved reviews to confirm this save.");
      if (current !== generation.current) throw new Error("The workspace changed. Open saved reviews to check the result.");
      setReviews(rows => [body.review, ...rows.filter(row => row.id !== body.review.id)]);
      attempt.current = null;
      return body.review as OpportunityReview;
    } catch (error) { const message = error instanceof Error && error.message !== "Failed to fetch" ? error.message : "The save was not confirmed. Retry to check the result."; if (current === generation.current) setError(message); throw new Error(message); }
    finally { pending.current = false; setBusy(false); }
  };
  return { reviews, canReview, historyAvailable, loading, busy, error, refresh,
    capture: (decision: OperatingDecision) => save("POST", { decisionId: decision.id, from: period?.from, to: period?.to }),
    update: async (review: OpportunityReview, change: ReviewChange) => { await save("PATCH", { id: review.id, version: review.version, ...change }); },
  };
}
