/** Formatting helpers for the authenticated workspace. */
export function comparisonCopy(rate: number | null | undefined, label: string) {
  if (rate == null || !Number.isFinite(rate)) return "Comparison unavailable";
  return `${new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(rate)} vs ${label}`;
}

export function quantityLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count.toLocaleString("en-CA")} ${count === 1 ? singular : plural}`;
}

/** Preserve refunds and negative profit in a zero-inclusive chart domain. */
export function chartDomain(values: number[]) {
  const finite = values.filter(Number.isFinite);
  const min = Math.min(0, ...finite);
  const max = Math.max(0, ...finite);
  if (min === max) return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
  const padding = (max - min) * 0.08;
  const lower = min < 0 ? min - padding : 0;
  const upper = max > 0 ? max + padding : 0;
  const rawStep = (upper - lower) / 4;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const step = ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= rawStep) ?? 10) * power;
  const start = Math.floor(lower / step) * step;
  const end = Math.ceil(upper / step) * step;
  return { min: start, max: end, ticks: Array.from({ length: Math.round((end - start) / step) + 1 }, (_, index) => start + index * step) };
}

export function chartY(value: number, height: number, domain: { min: number; max: number }) {
  return height - ((value - domain.min) / (domain.max - domain.min)) * height;
}
