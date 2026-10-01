let scriptPromise: Promise<void> | null = null;

export async function loadTurnstileConfiguration(action: string, signal: AbortSignal) {
  // Opening a protected account form already requires both resources. Start the
  // public script with the configuration request, then let the widget own any
  // script failure and its retry button. It shares this in-flight download.
  void loadTurnstile().catch(() => undefined);
  const response = await fetch(`/api/v1/auth/signup?action=${encodeURIComponent(action)}`, {
    headers: { accept: "application/json" }, signal,
  });
  const payload = await response.json() as { configured?: boolean; siteKey?: unknown; action?: unknown };
  signal.throwIfAborted();
  if (!response.ok || payload.configured !== true || typeof payload.siteKey !== "string" || !payload.siteKey.trim() || payload.action !== action) {
    throw new Error("Account protection is unavailable.");
  }
  return { siteKey: payload.siteKey, action };
}

// A failed download must not poison every later attempt in this browser tab.
export function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.vanteloqTurnstile = "true";
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else {
        resolve();
      }
    };
    const timeout = window.setTimeout(() => finish(new Error("Security verification timed out.")), 15000);
    script.onload = () => finish(window.turnstile ? undefined : new Error("Security verification did not initialize."));
    script.onerror = () => finish(new Error("Security verification could not load."));
    document.head.appendChild(script);
  }).catch(error => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}
