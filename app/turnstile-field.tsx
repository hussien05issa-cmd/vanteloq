"use client";

import { useEffect, useRef, useState } from "react";
import { loadTurnstile } from "./turnstile-loader";

type TurnstileApi = {
  render(container: HTMLElement, options: {
    sitekey: string;
    action: string;
    theme: "light";
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

  useEffect(() => { tokenCallback.current = onToken; }, [onToken]);
  useEffect(() => { errorCallback.current = onError; }, [onError]);

  useEffect(() => {
    if (!siteKey || !action || !container.current) return;
    let cancelled = false;
    const fail = (message: string) => {
      if (cancelled) return;
      tokenCallback.current("");
      setFailed(true);
      errorCallback.current(message);
    };
    void loadTurnstile().then(() => {
      if (cancelled || !window.turnstile || !container.current || widget.current) return;
      widget.current = window.turnstile.render(container.current, {
        sitekey: siteKey,
        action,
        theme: "light",
        callback: token => {
          if (cancelled) return;
          setFailed(false);
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
  }, [action, siteKey, attempt]);

  useEffect(() => {
    if (resetSignal > 0 && widget.current && window.turnstile) {
      tokenCallback.current("");
      window.turnstile.reset(widget.current);
    }
  }, [resetSignal]);

  return <div className="turnstile-field">
    <span>Security verification</span>
    <div ref={container} aria-label="Cloudflare security verification"/>
    {failed && <button className="auth-secondary" type="button" onClick={() => {
      setFailed(false);
      tokenCallback.current("");
      setAttempt(value => value + 1);
    }}>Retry security verification</button>}
    <small>Protected by Cloudflare Turnstile. No puzzle is shown unless additional verification is needed.</small>
  </div>;
}
