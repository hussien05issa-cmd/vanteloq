export type PersonalAdminEligibility = { allowed: boolean; checking: boolean };

/** Owns invalidation and response fencing; it stores no identity or preview data. */
export function createPersonalAdminEligibilityController(options: {
  scope: string;
  readScope: () => string;
  checkAccess: (signal: AbortSignal) => Promise<boolean>;
  onChange: (state: PersonalAdminEligibility) => void;
}) {
  let disposed = false;
  let revision = 0;
  let request: AbortController | null = null;
  const emit = (allowed: boolean, checking: boolean) => { if (!disposed) options.onChange({ allowed, checking }); };
  const invalidate = () => { revision++; request?.abort(); emit(false, false); };
  const check = async (clearFirst = false) => {
    if (disposed) return;
    if (options.readScope() !== options.scope) { invalidate(); return; }
    request?.abort();
    const controller = new AbortController(), current = ++revision;
    request = controller;
    if (clearFirst) emit(false, true);
    try {
      const allowed = await options.checkAccess(controller.signal);
      if (!disposed && !controller.signal.aborted && current === revision && options.readScope() === options.scope) emit(allowed, false);
    } catch {
      if (!disposed && !controller.signal.aborted && current === revision) emit(false, false);
    }
  };
  return {
    check,
    invalidate,
    // Every Auth event invalidates eligibility, including same-user token refresh.
    authChanged: (hasSession: boolean) => { if (hasSession) void check(true); else invalidate(); },
    dispose: () => { disposed = true; revision++; request?.abort(); },
  };
}
