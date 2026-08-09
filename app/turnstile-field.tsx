"use client";

import { useEffect, useRef } from "react";

type TurnstileApi = {
  render(container: HTMLElement, options: {
    sitekey: string;
    action: string;
    theme: "light";
    callback(token: string): void;
    "error-callback"(): void;
    "expired-callback"(): void;
  }): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window { turnstile?: TurnstileApi; }
}

let turnstileScript: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScript) return turnstileScript;
  turnstileScript = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-vanteloq-turnstile]');
    const script = existing ?? document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.vanteloqTurnstile = "true";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Turnstile failed to load.")), { once: true });
    if (!existing) document.head.appendChild(script);
  });
  return turnstileScript;
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

  useEffect(() => { tokenCallback.current = onToken; }, [onToken]);
  useEffect(() => { errorCallback.current = onError; }, [onError]);

  useEffect(() => {
    if (!siteKey || !action || !container.current) return;
    let cancelled = false;
    void loadTurnstile().then(() => {
      if (cancelled || !window.turnstile || !container.current || widget.current) return;
      widget.current = window.turnstile.render(container.current, {
        sitekey: siteKey,
        action,
        theme: "light",
        callback: token => tokenCallback.current(token),
        "expired-callback": () => tokenCallback.current(""),
        "error-callback": () => {
          tokenCallback.current("");
          errorCallback.current("The security check could not be completed. Please retry.");
        },
      });
    }).catch(() => errorCallback.current("The security check could not load. Please retry."));
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
      tokenCallback.current("");
    };
  }, [action, siteKey]);

  useEffect(() => {
    if (resetSignal > 0 && widget.current && window.turnstile) {
      tokenCallback.current("");
      window.turnstile.reset(widget.current);
    }
  }, [resetSignal]);

  return <div className="turnstile-field">
    <span>Security verification</span>
    <div ref={container} aria-label="Cloudflare security verification"/>
    <small>Protected by Cloudflare Turnstile. No puzzle is shown unless additional verification is needed.</small>
  </div>;
}
