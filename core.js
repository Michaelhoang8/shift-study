export function exampleData() {
  let seed = 73;
  return Array.from({ length: 120 }, (_, i) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (i < 40 ? 10 : i < 90 ? 20 : 12) + (seed / 2 ** 32 - 0.5) * 3;
  });
}
export const example = { values: exampleData(), penalty: 30, minLength: 5 };
export function validate(raw) {
  if (
    !raw ||
    !Array.isArray(raw.values) ||
    raw.values.length < 2 ||
    raw.values.length > 600 ||
    raw.values.some((x) => !Number.isFinite(x) || Math.abs(x) > 1000000)
  )
    throw Error("Use 2–600 finite observations within ±1000000.");
  if (!Number.isFinite(raw.penalty) || raw.penalty < 0 || raw.penalty > 1e12)
    throw Error("Penalty must be finite and between 0 and 1e12.");
  if (
    !Number.isInteger(raw.minLength) ||
    raw.minLength < 1 ||
    raw.minLength > 50 ||
    raw.minLength > raw.values.length
  )
    throw Error(
      "Minimum segment length must be 1–50 and no greater than the series length.",
    );
  return {
    values: [...raw.values],
    penalty: raw.penalty,
    minLength: raw.minLength,
  };
}
export function moments(values, start = 0, end = values.length) {
  let mean = 0,
    sse = 0,
    count = 0;
  const offset = values[start];
  for (let i = start; i < end; i++) {
    count++;
    const centered = values[i] - offset,
      delta = centered - mean;
    mean += delta / count;
    sse += delta * (centered - mean);
  }
  return { mean: mean + offset, sse: Math.max(0, sse), count };
}
function costs(values) {
  const n = values.length,
    table = Array.from({ length: n }, () => new Float64Array(n + 1));
  for (let start = 0; start < n; start++) {
    let mean = 0,
      sse = 0,
      count = 0;
    const offset = values[start];
    for (let end = start + 1; end <= n; end++) {
      count++;
      const centered = values[end - 1] - offset,
        delta = centered - mean;
      mean += delta / count;
      sse += delta * (centered - mean);
      table[start][end] = Math.max(0, sse);
    }
  }
  return table;
}
function solve(input, table, penalty) {
  const n = input.values.length,
    min = input.minLength,
    dp = Array(n + 1).fill(Infinity),
    counts = Array(n + 1).fill(Infinity),
    previous = Array(n + 1).fill(null);
  dp[0] = 0;
  counts[0] = 0;
  let candidates = 0;
  for (let end = min; end <= n; end++)
    for (let start = 0; start <= end - min; start++) {
      if (!Number.isFinite(dp[start])) continue;
      candidates++;
      const candidate = dp[start] + table[start][end] + (start ? penalty : 0),
        segments = counts[start] + 1;
      if (
        candidate < dp[end] ||
        (candidate === dp[end] && segments < counts[end])
      ) {
        dp[end] = candidate;
        counts[end] = segments;
        previous[end] = start;
      }
    }
  const segments = [];
  let end = n;
  while (end > 0) {
    const start = previous[end];
    if (start === null) throw Error("No feasible segmentation.");
    segments.unshift({ start, end, ...moments(input.values, start, end) });
    end = start;
  }
  const sse = segments.reduce((n, s) => n + s.sse, 0);
  return {
    penalty,
    segments,
    breakpoints: segments.slice(1).map((s) => s.start),
    sse,
    penaltyCost: penalty * (segments.length - 1),
    objective: dp[n],
    candidates,
    prefixes: dp.map((value, index) => ({
      end: index,
      objective: Number.isFinite(value) ? value : null,
      segments: Number.isFinite(counts[index]) ? counts[index] : null,
      previous: previous[index],
    })),
  };
}
export function fit(raw) {
  const input = validate(raw);
  return solve(input, costs(input.values), input.penalty);
}
export function analyze(raw) {
  const input = validate(raw),
    table = costs(input.values),
    result = solve(input, table, input.penalty),
    baseline = moments(input.values),
    penalties = [
      ...new Set([
        0,
        ...[0.125, 0.25, 0.5, 1, 2, 4, 8].map((f) =>
          Math.min(1e12, input.penalty * f),
        ),
      ]),
    ].sort((a, b) => a - b),
    sweep = penalties.map((p) => {
      const r = solve(input, table, p);
      return {
        penalty: p,
        segments: r.segments.length,
        breakpoints: r.breakpoints,
        sse: r.sse,
        objective: r.objective,
      };
    }),
    fitted = Array(input.values.length);
  for (const segment of result.segments)
    for (let i = segment.start; i < segment.end; i++) fitted[i] = segment.mean;
  return {
    format: "shift-study-evidence-v1",
    input,
    result,
    baseline,
    explainedFraction: baseline.sse ? 1 - result.sse / baseline.sse : null,
    fitted,
    residuals: input.values.map((v, i) => v - fitted[i]),
    sweep,
  };
}
