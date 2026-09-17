export type BookloqRefreshState = {
  inFlight: boolean;
  hasError: boolean;
  /** Set only after a successful current-scope read, using the same clock as now. */
  lastSuccessfulReadAt: number | null;
};

type BookloqRefreshRuntime = {
  now: () => number;
  isVisible: () => boolean;
  every: (callback: () => void, milliseconds: number) => () => void;
  onVisibilityChange: (callback: () => void) => () => void;
};

/** Schedules reads only. Initial/manual reads and request cancellation stay with the caller. */
export function startBookloqAutoRefresh({ refresh, getState, runtime }: {
  refresh: () => void | Promise<void>;
  getState: () => BookloqRefreshState;
  runtime: BookloqRefreshRuntime;
}): () => void {
  let disposed = false;
  let pending = false;
  let failedAfterSuccessAt: number | undefined;

  const attempt = (minimumAge: number) => {
    if (disposed || pending || !runtime.isVisible()) return;
    const state = getState();
    const lastSuccess = state.lastSuccessfulReadAt;
    if (state.inFlight || state.hasError || lastSuccess === null || !Number.isFinite(lastSuccess)) return;
    // A rejected callback must not create an unattended retry loop. A successful
    // explicit read re-enables refresh even if the caller handles errors itself.
    if (failedAfterSuccessAt !== undefined) {
      if (lastSuccess === failedAfterSuccessAt) return;
      failedAfterSuccessAt = undefined;
    }
    const age = runtime.now() - lastSuccess;
    if (!Number.isFinite(age) || age < minimumAge) return;
    pending = true;
    try {
      void Promise.resolve(refresh())
        .catch(() => { failedAfterSuccessAt = lastSuccess; })
        .finally(() => { pending = false; });
    } catch {
      failedAfterSuccessAt = lastSuccess;
      pending = false;
    }
  };

  const stopTimer = runtime.every(() => attempt(60_000), 60_000);
  const stopVisibility = runtime.onVisibilityChange(() => attempt(15_000));
  return () => {
    if (disposed) return;
    disposed = true;
    stopTimer();
    stopVisibility();
  };
}
