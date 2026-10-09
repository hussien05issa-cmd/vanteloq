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

export type ChartPoint = Readonly<{ x: number; y: number }>;

/** Smooth presentation through the recorded points, with no added extrema.
 * PCHIP slopes: https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.PchipInterpolator.html
 * Call separately for each continuous observation segment. Invalid coordinates
 * break the path; repeated or descending x values retain straight connections. */
export function smoothChartPath(points: readonly ChartPoint[]): string {
  const straightPath = () => {
    let connected = false;
    return points.flatMap(point => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        connected = false;
        return [];
      }
      const command = `${connected ? "L" : "M"}${point.x},${point.y}`;
      connected = true;
      return [command];
    }).join(" ");
  };

  if (points.length < 3 || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return straightPath();

  const intervals = points.slice(1).map((point, index) => point.x - points[index].x);
  const secants = points.slice(1).map((point, index) => (point.y - points[index].y) / intervals[index]);
  if (intervals.some(interval => !Number.isFinite(interval) || interval <= 0) || secants.some(slope => !Number.isFinite(slope))) return straightPath();

  const endpointSlope = (firstInterval: number, nextInterval: number, firstSlope: number, nextSlope: number) => {
    const scale = Math.max(firstInterval, nextInterval);
    const firstWeight = firstInterval / scale;
    const ratio = firstWeight / (firstWeight + nextInterval / scale);
    const slope = (1 + ratio) * firstSlope - ratio * nextSlope;
    if (Math.sign(slope) !== Math.sign(firstSlope)) return 0;
    if (Math.sign(firstSlope) !== Math.sign(nextSlope) && Math.abs(slope) > 3 * Math.abs(firstSlope)) return 3 * firstSlope;
    return slope;
  };

  const slopes = [endpointSlope(intervals[0], intervals[1], secants[0], secants[1])];
  for (let index = 1; index < points.length - 1; index++) {
    const leftSlope = secants[index - 1], rightSlope = secants[index];
    if (leftSlope === 0 || rightSlope === 0 || Math.sign(leftSlope) !== Math.sign(rightSlope)) {
      slopes.push(0);
      continue;
    }
    const intervalScale = Math.max(intervals[index - 1], intervals[index]);
    const leftInterval = intervals[index - 1] / intervalScale, rightInterval = intervals[index] / intervalScale;
    const leftWeight = (2 * rightInterval + leftInterval) / (3 * (leftInterval + rightInterval));
    const rightWeight = (rightInterval + 2 * leftInterval) / (3 * (leftInterval + rightInterval));
    const slopeScale = Math.min(Math.abs(leftSlope), Math.abs(rightSlope));
    slopes.push(Math.sign(leftSlope) * slopeScale / (leftWeight * slopeScale / Math.abs(leftSlope) + rightWeight * slopeScale / Math.abs(rightSlope)));
  }
  const last = intervals.length - 1;
  slopes.push(endpointSlope(intervals[last], intervals[last - 1], secants[last], secants[last - 1]));
  if (slopes.some(slope => !Number.isFinite(slope))) return straightPath();

  let path = `M${points[0].x},${points[0].y}`;
  for (let index = 0; index < intervals.length; index++) {
    const first = points[index], next = points[index + 1], third = intervals[index] / 3;
    const minimum = Math.min(first.y, next.y), maximum = Math.max(first.y, next.y);
    const clamp = (value: number) => Math.max(minimum, Math.min(maximum, value));
    const firstControlY = clamp(first.y + slopes[index] * third);
    const nextControlY = clamp(next.y - slopes[index + 1] * third);
    path += ` C${first.x + third},${firstControlY} ${next.x - third},${nextControlY} ${next.x},${next.y}`;
  }
  return path;
}
