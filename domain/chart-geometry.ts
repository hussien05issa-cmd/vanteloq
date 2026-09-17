/** Presentation geometry only. Never add, interpolate or round source values. */
export function temporalPositions(times: readonly number[], width: number): number[] {
  if (!times.length) return [];
  if (!Number.isFinite(width) || width < 0 || times.some(time => !Number.isFinite(time))) throw new Error("Invalid chart coordinates");
  const first = Math.min(...times), last = Math.max(...times);
  return times.map(time => last === first ? width / 2 : (time - first) / (last - first) * width);
}

/** Keep date labels apart even when observations cluster beside a long gap. */
export function temporalLabelIndices(positions: readonly number[], minimumGap = 84): number[] {
  if (!positions.length) return [];
  const chosen = [0], last = positions.length - 1;
  for (let index = 1; index < last; index++) {
    if (positions[index] - positions[chosen[chosen.length - 1]] >= minimumGap && positions[last] - positions[index] >= minimumGap) chosen.push(index);
  }
  if (last > 0 && positions[last] - positions[chosen[chosen.length - 1]] >= minimumGap) chosen.push(last);
  return chosen;
}

export type ObservationSegment = { path: string; firstIndex: number; lastIndex: number; firstX: number; lastX: number };

/** Missing values and missing scheduled observations break the plotted line.
 * The caller retains isolated points as markers; a segment is never a new record. */
export function observationSegments(values: readonly (number | null)[], times: readonly number[], positions: readonly number[], y: (value: number) => number, interval: number): ObservationSegment[] {
  if (values.length !== times.length || values.length !== positions.length || !Number.isFinite(interval) || interval <= 0) throw new Error("Invalid chart series");
  const result: ObservationSegment[] = [];
  let previousIndex = -1;
  for (let index = 0; index < values.length; index++) {
    const value = values[index], x = positions[index];
    if (value === null || !Number.isFinite(value) || !Number.isFinite(x) || !Number.isFinite(times[index])) { previousIndex = -1; continue; }
    const ordinate = y(value);
    if (!Number.isFinite(ordinate)) { previousIndex = -1; continue; }
    const coordinate = `${x.toFixed(2)},${ordinate.toFixed(2)}`;
    if (previousIndex === index - 1 && previousIndex >= 0 && times[index] - times[previousIndex] === interval) {
      const segment = result[result.length - 1];
      segment.path += ` L${coordinate}`; segment.lastIndex = index; segment.lastX = x;
    } else result.push({ path: `M${coordinate}`, firstIndex: index, lastIndex: index, firstX: x, lastX: x });
    previousIndex = index;
  }
  return result;
}

/** Percentages describe a signed axis, not an absolute-value magnitude bar. */
export function signedBarGeometry(value: number, minimum: number, maximum: number) {
  if (![value, minimum, maximum].every(Number.isFinite) || minimum > 0 || maximum < 0 || minimum > maximum || value < minimum || value > maximum) throw new Error("Invalid signed chart range");
  const span = maximum > minimum ? maximum - minimum : 1;
  const zero = -minimum / span * 100;
  const end = (value - minimum) / span * 100;
  return { zero, left: Math.min(zero, end), width: Math.abs(end - zero), negative: value < 0 };
}

export function axisNumber(value: number, step: number) {
  let digits = 0;
  while (digits < 8 && Math.abs(step * 10 ** digits - Math.round(step * 10 ** digits)) > 1e-8) digits++;
  const compact = Math.abs(value) >= 10_000 && step >= 1_000;
  return new Intl.NumberFormat("en-CA", { notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : digits }).format(value);
}
