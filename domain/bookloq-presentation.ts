export function bookloqMetricCount(value: number | null | undefined) {
  return value == null ? "Not available" : String(value);
}

export function bookloqHealthPresentation(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  const score = Math.max(0, Math.min(100, value));
  return { score, degrees: score * 3.6 };
}
