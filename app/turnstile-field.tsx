"use client";

import { useEffect, useRef, useState } from "react";
import { loadTurnstile } from "./turnstile-loader";

type TurnstileApi = {
  render(container: HTMLElement, options: {
    sitekey: string;
    action: string;
    theme: "dark";
    size: "flexible" | "compact";
    callback(token: string): void;
    "error-callback"(code: string): void;
    "expired-callback"(): void;
    "timeout-callback"(): void;
  }): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window { turnstile?: TurnstileApi; }
}

export default function TurnstileField({
  siteKey,
  action,
  resetSignal,
  onToken,
  onError,
}: {
  siteKey: string;
  action: string;
  resetSignal: number;
  onToken: (token: string) => void;
  onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const tokenCallback = useRef(onToken);
  const errorCallback = useRef(onError);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [widgetSize, setWidgetSize] = useState<"flexible" | "compact" | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<"loading" | "ready" | "verified" | "failed">("loading");

  useEffect(() => { tokenCallback.current = onToken; }, [onToken]);
  useEffect(() => { errorCallback.current = onError; }, [onError]);

  useEffect(() => {
    if (!container.current) return;
    const element = container.current;
    // Cloudflare's flexible widget has a supported minimum width of 300px.
    // Use its compact presentation on narrower forms, without scaling or
    // clipping the protected iframe or changing the challenge mode.
    const measure = () => setWidgetSize(element.getBoundingClientRect().width < 300 ? "compact" : "flexible");
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!siteKey || !action || !container.current || !widgetSize) return;
    let cancelled = false;
    const fail = (message: string) => {
      if (cancelled) return;
      tokenCallback.current("");
      setFailed(true);
      setVerificationStatus("failed");
      errorCallback.current(message);
    };
    void loadTurnstile().then(() => {
      if (cancelled || !window.turnstile || !container.current || widget.current) return;
      setVerificationStatus("ready");
      widget.current = window.turnstile.render(container.current, {
        sitekey: siteKey,
        action,
        theme: "dark",
        size: widgetSize,
        callback: token => {
          if (cancelled) return;
          setFailed(false);
          setVerificationStatus("verified");
          tokenCallback.current(token);
        },
        "expired-callback": () => fail("The security check expired. Retry verification to continue."),
        "timeout-callback": () => fail("The security check timed out. Retry verification to continue."),
        "error-callback": () => fail("The security check could not be completed. Retry verification. If it keeps failing, open Vanteloq in an updated Chrome, Edge, Firefox or Safari browser."),
      });
    }).catch(() => fail("The security check could not load. Check your connection and retry verification."));
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
      tokenCallback.current("");
    };
  }, [action, siteKey, attempt, widgetSize]);

  useEffect(() => {
    if (resetSignal > 0 && widget.current && window.turnstile) {
      tokenCallback.current("");
      setVerificationStatus("ready");
      window.turnstile.reset(widget.current);
    }
  }, [resetSignal]);

  return <div className="turnstile-field" data-verification-status={verificationStatus}>
    <span>Security verification</span>
    <div ref={container} className="turnstile-widget-container" data-size={widgetSize ?? "pending"} aria-label="Cloudflare security verification"/>
    <p className="turnstile-status" role="status">{verificationStatus === "verified" ? "Security check complete." : verificationStatus === "failed" ? "Security check needs attention." : verificationStatus === "ready" ? "Cloudflare is checking this session." : "Loading security check…"}</p>
    {failed && <button className="auth-secondary" type="button" onClick={() => {
      setFailed(false);
      setVerificationStatus("loading");
      tokenCallback.current("");
      setAttempt(value => value + 1);
    }}>Retry security verification</button>}
    <small>Protected by Cloudflare Turnstile. No puzzle is shown unless additional verification is needed.</small>
  </div>;
}
