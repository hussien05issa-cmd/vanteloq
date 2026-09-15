export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_MAX_MS = 8 * 60 * 60 * 1000;
export const SESSION_WARNING_MS = 2 * 60 * 1000;

export function sessionRemaining(now: number, lastActivity: number, absoluteExpiry: number): number {
  return Math.max(0, Math.min(lastActivity + SESSION_IDLE_MS, absoluteExpiry) - now);
}
