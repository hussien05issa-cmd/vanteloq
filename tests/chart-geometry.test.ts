import assert from "node:assert/strict";
import test from "node:test";
import { temporalPositions, temporalLabelIndices, observationSegments, signedBarGeometry, axisNumber } from "../domain/chart-geometry";

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
