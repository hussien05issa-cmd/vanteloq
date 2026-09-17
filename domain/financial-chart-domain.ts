/** Financial presentation only. Keeps zero and every finite value visible without
 * extending a tiny loss to a full coarse tick. Never changes the source amounts. */
export function financialChartDomain(values: readonly number[]) {
  const finite = values.filter(Number.isFinite);
  const observedMin = Math.min(0, ...finite);
  const observedMax = Math.max(0, ...finite);
  if (observedMin === observedMax) return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
  const span = observedMax - observedMin;
  const padding = span * 0.04;
  const min = observedMin < 0 ? observedMin - padding : 0;
  const max = observedMax > 0 ? observedMax + padding : 0;
  const rawStep = (max - min) / 5;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const step = ([1, 2, 2.5, 5, 10].find(factor => factor * power >= rawStep) ?? 10) * power;
  // Tick labels use round amounts; bounds need not coincide with a tick.
  const first = Math.ceil(min / step);
  const last = Math.floor(max / step);
  const ticks = Array.from({ length: last - first + 1 }, (_, i) => {
    const value = (first + i) * step;
    return Object.is(value, -0) ? 0 : value;
  });
  return { min, max, ticks };
}
