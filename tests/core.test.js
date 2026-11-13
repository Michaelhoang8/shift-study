import test from "node:test";
import assert from "node:assert/strict";
import { example, fit, analyze, moments, validate } from "../core.js";
const close = (a, b, tol = 1e-8) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
test("seeded level-change example recovers the two constructed boundaries", () => {
  const r = analyze(example);
  assert.deepEqual(r.result.breakpoints, [40, 90]);
  assert.equal(r.result.segments.length, 3);
  close(r.result.objective, r.result.sse + 60);
});
test("constant series prefers fewer segments on exact ties, including zero penalty", () => {
  const r = analyze({ values: Array(30).fill(7), penalty: 0, minLength: 1 });
  assert.equal(r.result.segments.length, 1);
  assert.equal(r.result.sse, 0);
  assert.equal(r.explainedFraction, null);
});
test("minimum lengths apply to both first and final segments", () => {
  const r = fit({ values: [0, 0, 0, 9, 9, 9, 100], penalty: 0, minLength: 3 });
  assert.ok(r.segments.every((s) => s.count >= 3));
  assert.equal(r.segments.at(-1).end, 7);
});
test("large penalty returns one segment without subtractive penalty cancellation", () => {
  const input = {
      values: [0, 0.001, 0.002, 0.003],
      penalty: 1e12,
      minLength: 1,
    },
    r = fit(input);
  assert.equal(r.segments.length, 1);
  close(r.objective, 0.000005, 1e-16);
});
test("translation and scaling preserve segmentation when the penalty scales quadratically", () => {
  const base = fit(example),
    translated = fit({
      ...example,
      values: example.values.map((v) => v + 900000),
    }),
    scaled = fit({
      ...example,
      values: example.values.map((v) => v * 3),
      penalty: example.penalty * 9,
    });
  assert.deepEqual(translated.breakpoints, base.breakpoints);
  assert.deepEqual(scaled.breakpoints, base.breakpoints);
  close(scaled.sse, base.sse * 9, 1e-7);
  close(translated.sse, base.sse, 1e-7);
});
test("dynamic program agrees with all feasible partitions of 300 short series", () => {
  let seed = 73;
  const rand = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let trial = 0; trial < 300; trial++) {
    const values = Array.from({ length: 4 + rand(6) }, () => rand(11) - 5),
      minLength = 1 + rand(3),
      penalty = rand(12) / 2,
      input = { values, minLength, penalty },
      r = fit(input);
    let best = Infinity,
      bestCount = Infinity;
    for (let mask = 0; mask < 2 ** (values.length - 1); mask++) {
      const cuts = [
        0,
        ...Array.from({ length: values.length - 1 }, (_, i) => i + 1).filter(
          (i) => mask & (1 << (i - 1)),
        ),
        values.length,
      ];
      if (cuts.some((v, i) => i && v - cuts[i - 1] < minLength)) continue;
      let sse = 0;
      for (let i = 1; i < cuts.length; i++) {
        const slice = values.slice(cuts[i - 1], cuts[i]),
          mean = slice.reduce((a, b) => a + b, 0) / slice.length;
        sse += slice.reduce((n, v) => n + (v - mean) ** 2, 0);
      }
      const objective = sse + penalty * (cuts.length - 2);
      if (objective < best - 1e-10) {
        best = objective;
        bestCount = cuts.length - 1;
      } else if (Math.abs(objective - best) < 1e-10)
        bestCount = Math.min(bestCount, cuts.length - 1);
    }
    close(r.objective, best, 1e-8);
    assert.ok(r.segments.every((s) => s.count >= minLength));
  }
});
test("penalty sweep never increases segment count as penalty grows", () => {
  for (let seed = 0; seed < 30; seed++) {
    const values = Array.from(
        { length: 40 },
        (_, i) => Math.sin(i * 1.3 + seed) * 3 + (i > 20 ? 8 : 0),
      ),
      r = analyze({ values, penalty: 5, minLength: 2 });
    for (let i = 1; i < r.sweep.length; i++)
      assert.ok(r.sweep[i].segments <= r.sweep[i - 1].segments);
  }
});
test("residual sums, interval coverage and prefix diagnostics are consistent", () => {
  const r = analyze(example);
  assert.equal(r.fitted.length, 120);
  let end = 0;
  for (const s of r.result.segments) {
    assert.equal(s.start, end);
    end = s.end;
    close(
      r.residuals.slice(s.start, s.end).reduce((a, b) => a + b, 0),
      0,
      1e-10,
    );
    close(
      r.residuals.slice(s.start, s.end).reduce((a, b) => a + b * b, 0),
      s.sse,
    );
  }
  assert.equal(end, 120);
  assert.equal(r.result.prefixes[1].objective, null);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});
test("validation rejects invalid sizes, nonfinite data and incompatible minimums", () => {
  for (const edit of [
    { values: [1] },
    { values: [1, NaN] },
    { penalty: -1 },
    { minLength: 121 },
    { values: Array(601).fill(0) },
  ])
    assert.throws(() => validate({ ...example, ...edit }));
  close(moments([1, 2, 3]).sse, 2);
});
