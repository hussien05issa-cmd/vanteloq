"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type ComponentType } from "react";

type AdvisoryFormComponent = ComponentType<{ purpose?: "advisory" }>;
export type AdvisoryInquiryPhase = "waiting" | "loading" | "ready" | "error";
export type AdvisoryInquiryState = { phase: AdvisoryInquiryPhase; error: string; attempt: number };
export type AdvisoryInquiryAction =
  | { type: "start" }
  | { type: "ready" }
  | { type: "fail"; message: string }
  | { type: "retry" };

export function isAdvisoryInquiryHash(hash: string) {
  return hash === "#advisory-inquiry-form" || hash === "#contact";
}

export function advisoryInquiryReducer(state: AdvisoryInquiryState, action: AdvisoryInquiryAction): AdvisoryInquiryState {
  switch (action.type) {
    case "start":
      return state.phase === "waiting" ? { ...state, phase: "loading" } : state;
    case "ready":
      return { ...state, phase: "ready", error: "" };
    case "fail":
      return { ...state, phase: "error", error: action.message };
    case "retry":
      return { phase: "loading", error: "", attempt: state.attempt + 1 };
  }
}

function AdvisoryInquirySkeleton({ announced }: { announced: boolean }) {
  return <div
    className="advisory-inquiry-skeleton"
    role={announced ? "status" : undefined}
    aria-live={announced ? "polite" : undefined}
    aria-atomic={announced ? true : undefined}
  >
    <span className="advisory-visually-hidden">{announced ? "Preparing the secure advisory inquiry form." : ""}</span>
    <div className="advisory-inquiry-skeleton-content" aria-hidden="true">
      <span className="advisory-skeleton-line advisory-skeleton-line-short" />
      <div className="advisory-skeleton-fields">
        <span className="advisory-skeleton-field" />
        <span className="advisory-skeleton-field" />
        <span className="advisory-skeleton-field" />
        <span className="advisory-skeleton-field" />
      </div>
      <span className="advisory-skeleton-field advisory-skeleton-message" />
      <span className="advisory-skeleton-line advisory-skeleton-line-wide" />
      <span className="advisory-skeleton-field advisory-skeleton-consent" />
      <span className="advisory-skeleton-field advisory-skeleton-verification" />
      <span className="advisory-skeleton-button" />
    </div>
  </div>;
}

export default function AdvisoryInquiry() {
  const panel = useRef<HTMLDivElement>(null);
  const [Form, setForm] = useState<AdvisoryFormComponent | null>(null);
  const [state, dispatch] = useReducer(advisoryInquiryReducer, { phase: "waiting", error: "", attempt: 0 });

  const beginLoading = useCallback(() => dispatch({ type: "start" }), []);

  useEffect(() => {
    const target = panel.current;
    if (!target) return;

    const revealForHash = () => {
      if (isAdvisoryInquiryHash(window.location.hash)) queueMicrotask(beginLoading);
    };
    revealForHash();
    window.addEventListener("hashchange", revealForHash);

    if (!("IntersectionObserver" in window)) {
      const frame = requestAnimationFrame(beginLoading);
      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("hashchange", revealForHash);
      };
    }

    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        beginLoading();
        observer.disconnect();
      }
    }, { rootMargin: "640px 0px" });
    observer.observe(target);

    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", revealForHash);
    };
  }, [beginLoading]);

  useEffect(() => {
    if (state.phase !== "loading" || Form) return;
    let active = true;
    void import("../custom-plan-form")
      .then(module => {
        if (!active) return;
        setForm(() => module.default as AdvisoryFormComponent);
        dispatch({ type: "ready" });
      })
      .catch(() => {
        if (active) dispatch({ type: "fail", message: "The secure form could not load. Please retry." });
      });
    return () => { active = false; };
  }, [Form, state.attempt, state.phase]);

  return <div
    ref={panel}
    id="advisory-inquiry-form"
    className="advisory-contact-panel"
    data-inquiry-purpose="advisory"
    data-loading-state={state.phase}
    aria-busy={state.phase === "loading"}
  >
    {Form ? <Form purpose="advisory" /> : state.phase === "error" ? <div className="advisory-inquiry-load-error" role="alert">
      <p>{state.error}</p>
      <button type="button" onClick={() => dispatch({ type: "retry" })}>Retry Loading the Form</button>
    </div> : <AdvisoryInquirySkeleton announced={state.phase === "loading"} />}
  </div>;
}
