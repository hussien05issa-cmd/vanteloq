import assert from "node:assert/strict";
import test from "node:test";
import { temporalPositions, temporalLabelIndices, observationSegments, signedBarGeometry, axisNumber, smoothChartPath, type ChartPoint } from "../domain/chart-geometry";

const day = 86_400_000;
const stamp = (date: string) => Date.parse(`${date}T00:00:00Z`);

test("calendar spacing distinguishes a one-day interval from a missing week without adding observations", () => {
  const dates = ["2026-08-01", "2026-08-02", "2026-08-10"].map(stamp);
  const values = [10001, -5999, 42000];
  const before = JSON.stringify({ dates, values });
  const x = temporalPositions(dates, 900);
  assert.deepEqual(x, [0, 100, 900]);
  const segments = observationSegments(values, dates, x, value => value, day);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map(s => [s.firstIndex, s.lastIndex]), [[0, 1], [2, 2]]);
  assert.equal(JSON.stringify({ dates, values }), before);
  assert.equal(segments[0].lastX - segments[0].firstX, 100);
  assert.equal(segments[1].firstX, 900);
});

test("leap-day and daylight-saving calendar dates keep consecutive UTC daily spacing", () => {
  for (const dates of [["2024-02-28", "2024-02-29", "2024-03-01"], ["2026-03-07", "2026-03-08", "2026-03-09"]]) {
    const times = dates.map(stamp), x = temporalPositions(times, 600);
    assert.deepEqual(x, [0, 300, 600]);
    assert.equal(observationSegments([0, -105, 307], times, x, value => value, day).length, 1);
  }
});

test("unknown profit breaks the line while a real zero and negative value stay plotted", () => {
  const times = [0, day, 2 * day, 3 * day];
  const segments = observationSegments([0, null, -105, 307], times, temporalPositions(times, 300), value => value, day);
  assert.deepEqual(segments.map(s => [s.firstIndex, s.lastIndex]), [[0, 0], [2, 3]]);
  assert.equal(segments[0].path, "M0.00,0.00");
  assert.ok(segments[1].path.includes("-105.00"));
});

test("a single observation stays at a finite midpoint without manufacturing another date", () => {
  const times = [stamp("2026-09-17")];
  assert.deepEqual(temporalPositions(times, 640), [320]);
  assert.deepEqual(observationSegments([-5999], times, [320], value => value, day).map(s => [s.firstIndex, s.lastIndex]), [[0, 0]]);
});

test("date labels do not collide when observed dates cluster beside a long interval", () => {
  assert.deepEqual(temporalLabelIndices([0, 7, 436], 84), [0, 2]);
  const positions = [0, 60, 120, 180, 240, 300, 360, 436];
  const selected = temporalLabelIndices(positions, 84);
  for (let index = 1; index < selected.length; index++) assert.ok(positions[selected[index]] - positions[selected[index - 1]] >= 84);
});

test("diverging category bars preserve signs and relative magnitudes around a shared zero", () => {
  const negative = signedBarGeometry(-50, -50, 150), positive = signedBarGeometry(150, -50, 150), zero = signedBarGeometry(0, -50, 150);
  assert.deepEqual(negative, { zero: 25, left: 0, width: 25, negative: true });
  assert.deepEqual(positive, { zero: 25, left: 25, width: 75, negative: false });
  assert.equal(zero.width, 0);
  assert.equal(negative.left + negative.width, negative.zero);
  assert.equal(positive.left, positive.zero);
});

test("all-negative, zero-only and fractional bar ranges remain finite and correctly signed", () => {
  assert.deepEqual(signedBarGeometry(-20, -100, 0), { zero: 100, left: 80, width: 20, negative: true });
  assert.equal(signedBarGeometry(0, 0, 0).width, 0);
  assert.equal(signedBarGeometry(-0.01, -0.01, 0.01).width, 50);
  assert.throws(() => signedBarGeometry(NaN, -1, 1));
  assert.throws(() => signedBarGeometry(100, 0, 10));
});

test("close fractional rank ticks remain distinguishable", () => {
  const labels = [1.01, 1.0125, 1.015, 1.0175, 1.02].map(value => axisNumber(value, .0025));
  assert.equal(new Set(labels).size, 5);
  assert.equal(axisNumber(2.5, 2.5), "2.5");
});

const pathCommands = (path: string) => [...path.matchAll(/([MLC])([^MLC]+)/g)].map(match => ({
  command: match[1],
  values: match[2].trim().split(/[\s,]+/).map(Number),
}));

const cubicValue = (start: number, firstControl: number, secondControl: number, end: number, t: number) =>
  (1 - t) ** 3 * start + 3 * (1 - t) ** 2 * t * firstControl + 3 * (1 - t) * t ** 2 * secondControl + t ** 3 * end;

test("smooth paths pass through every exact recorded coordinate without rounding endpoints", () => {
  const points = [{ x: 0.125, y: 3.141592653589793 }, { x: 12.875, y: -1.12345678901234 }, { x: 98.625, y: 6.98765432109876 }];
  const commands = pathCommands(smoothChartPath(points));
  assert.deepEqual(commands[0], { command: "M", values: [points[0].x, points[0].y] });
  assert.equal(commands.length, points.length);
  for (let index = 1; index < commands.length; index++) {
    assert.equal(commands[index].command, "C");
    assert.deepEqual(commands[index].values.slice(-2), [points[index].x, points[index].y]);
    assert.ok(commands[index].values.every(Number.isFinite));
  }
});

test("smooth curves stay between adjacent observations across turns, flat periods and uneven spacing", () => {
  const series: ChartPoint[][] = [
    [{ x: 0, y: 8 }, { x: 30, y: 2 }, { x: 60, y: 6 }, { x: 90, y: -4 }, { x: 120, y: 3 }],
    [{ x: 0, y: 8 }, { x: 1, y: 2 }, { x: 35, y: 2 }, { x: 36, y: 2 }, { x: 100, y: -4 }],
    [{ x: 0, y: -5 }, { x: .01, y: 2 }, { x: 10, y: 2.1 }, { x: 60, y: 12 }],
    [{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 50, y: 3 }],
  ];
  for (const points of series) {
    const commands = pathCommands(smoothChartPath(points));
    for (let index = 1; index < commands.length; index++) {
      const first = points[index - 1], next = points[index], controls = commands[index].values;
      let previousY = first.y;
      for (let sample = 0; sample <= 100; sample++) {
        const t = sample / 100;
        const x = cubicValue(first.x, controls[0], controls[2], next.x, t);
        const y = cubicValue(first.y, controls[1], controls[3], next.y, t);
        assert.ok(x >= first.x - 1e-10 && x <= next.x + 1e-10);
        assert.ok(Math.abs(x - (first.x + (next.x - first.x) * t)) < 1e-10, "time spacing stays linear");
        assert.ok(y >= Math.min(first.y, next.y) - 1e-10 && y <= Math.max(first.y, next.y) + 1e-10, "curve adds no overshoot");
        if (next.y >= first.y) assert.ok(y >= previousY - 1e-10);
        else assert.ok(y <= previousY + 1e-10);
        previousY = y;
      }
    }
  }
});

test("uneven intervals use a continuous weighted slope and turns have horizontal tangents", () => {
  const commands = pathCommands(smoothChartPath([{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 10, y: 3 }, { x: 12, y: 2 }]));
  const arrivingSlope = 3 * (2 - commands[1].values[3]);
  const departingSlope = 3 * (commands[2].values[1] - 2) / 9;
  assert.ok(Math.abs(arrivingSlope - 60 / 217) < 1e-12);
  assert.ok(Math.abs(arrivingSlope - departingSlope) < 1e-12);
  assert.equal(commands[2].values[3], 3);
  assert.equal(commands[3].values[1], 3);
  const clippedEndpoint = pathCommands(smoothChartPath([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: -100 }]));
  assert.equal(clippedEndpoint[1].values[1], 1, "steep reversal limits the endpoint tangent to three times its secant");
});

test("empty, isolated and two-point paths remain simple and missing coordinates break connections", () => {
  assert.equal(smoothChartPath([]), "");
  assert.equal(smoothChartPath([{ x: 1.23456, y: -9.87654 }]), "M1.23456,-9.87654");
  assert.equal(smoothChartPath([{ x: 0, y: 1 }, { x: 2, y: 3 }]), "M0,1 L2,3");
  assert.equal(smoothChartPath([{ x: 0, y: 1 }, { x: NaN, y: 2 }, { x: 4, y: 3 }, { x: 5, y: 4 }]), "M0,1 M4,3 L5,4");
  assert.equal(smoothChartPath([{ x: 0, y: 1 }, { x: 2, y: Infinity }, { x: 4, y: 3 }]), "M0,1 M4,3");
});

test("duplicate or descending time coordinates fall back to straight paths without division errors", () => {
  assert.equal(smoothChartPath([{ x: 0, y: 1 }, { x: 0, y: 3 }, { x: 2, y: 4 }]), "M0,1 L0,3 L2,4");
  assert.equal(smoothChartPath([{ x: 0, y: 1 }, { x: 2, y: 3 }, { x: 1, y: 4 }]), "M0,1 L2,3 L1,4");
});

test("smooth geometry accepts frozen input and leaves source coordinates intact", () => {
  const points = Object.freeze([Object.freeze({ x: 0, y: 10 }), Object.freeze({ x: 5, y: -7 }), Object.freeze({ x: 12, y: 1 })]);
  const before = JSON.stringify(points);
  assert.ok(smoothChartPath(points).includes("C"));
  assert.equal(JSON.stringify(points), before);
});
