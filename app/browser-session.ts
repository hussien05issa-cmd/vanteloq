import type { Session } from "@supabase/supabase-js";

/** Transport snapshot only. The server still verifies every JWT and permission. */
export function createSessionReader(readFresh: () => Promise<Session | null>, { timeoutMs = 10_000, now = Date.now } = {}) {
  let snapshot: Session | null | undefined;
  let revision = 0;
  let pending: Promise<Session | null> | null = null;
  const usable = (session: Session | null | undefined): session is Session =>
    Boolean(session?.access_token && session.expires_at && session.expires_at * 1000 > now() + 30_000);
  const update = (session: Session | null) => { snapshot = session; revision++; };
  const read = (): Promise<Session | null> => {
    if (snapshot === null || usable(snapshot)) return Promise.resolve(snapshot);
    if (pending) return pending;
    const startedAtRevision = revision;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Your sign-in session could not be checked. Refresh Vanteloq and try again.")), timeoutMs);
    });
    const attempt = Promise.race([readFresh(), deadline]).then(session => {
      // Sign-out or an account/token change wins over an older pending lookup.
      if (revision !== startedAtRevision) {
        if (snapshot === null || usable(snapshot)) return snapshot;
        throw new Error("Your sign-in changed. Refresh Vanteloq and try again.");
      }
      if (session && !usable(session)) throw new Error("Your sign-in needs to refresh. Try again in a moment.");
      snapshot = session;
      return session;
    }).finally(() => { clearTimeout(timer); if (pending === attempt) pending = null; });
    pending = attempt;
    return attempt;
  };
  return { read, update };
}
