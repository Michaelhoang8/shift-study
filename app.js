import { example } from "./core.js";
const $ = (id) => document.getElementById(id),
  fmt = (x) => Number(x.toPrecision(7)).toString();
let report = null,
  selected = 0,
  worker = null;
function busy(value) {
  for (const e of document.querySelectorAll("button,input,textarea"))
    e.disabled = value;
  for (const id of ["export", "save", "csv"]) $(id).disabled = value || !report;
}
function run(input) {
  worker?.terminate();
  busy(true);
  $("message").textContent =
    "Computing the optimal partition and penalty sensitivity…";
  worker = new Worker("./worker.js", { type: "module" });
  worker.onmessage = ({ data }) => {
    worker.terminate();
    worker = null;
    if (data.error) {
      busy(false);
      $("message").textContent = data.error;
      return;
    }
    report = data.result;
    selected = 0;
    busy(false);
    $("penalty").value = report.input.penalty;
    $("minimum").value = report.input.minLength;
    $("values").value = JSON.stringify(report.input.values, null, 2);
    render();
    $("message").textContent =
      "Fit complete. Results describe the last applied study.";
  };
  worker.onerror = () => {
    worker?.terminate();
    worker = null;
    busy(false);
    $("message").textContent = "The analysis worker failed.";
  };
  worker.postMessage(input);
}
function render() {
  const r = report.result,
    n = report.input.values.length,
    s = r.segments[selected];
  $("segments").textContent = r.segments.length;
  $("sse").textContent = fmt(r.sse);
  $("objective").textContent = fmt(r.objective);
  $("explained").textContent =
    report.explainedFraction === null
      ? "—"
      : (100 * report.explainedFraction).toFixed(2) + "%";
  const low = Math.min(...report.input.values),
    high = Math.max(...report.input.values),
    span = high - low || 1,
    Y = (v) => 315 - ((v - low) / span) * 250,
    X = (i) => 60 + (i / n) * 1000;
  let svg = `<text x="10" y="65">${fmt(high)}</text><text x="10" y="315">${fmt(low)}</text><text x="60" y="355">0</text><text x="1010" y="355">${n - 1}</text>`;
  svg += r.segments
    .map(
      (seg, i) =>
        `<rect class="region ${selected === i ? "selected" : ""}" x="${X(seg.start)}" y="40" width="${X(seg.end) - X(seg.start)}" height="290" tabindex="0" role="button" data-segment="${i}" aria-label="Segment ${i + 1}, indices ${seg.start} to ${seg.end - 1}, mean ${fmt(seg.mean)}"/>`,
    )
    .join("");
  svg += `<path class="observation" d="${report.input.values.map((v, i) => `${i ? "L" : "M"}${X(i + 0.5)},${Y(v)}`).join(" ")}"/>`;
  svg += r.segments
    .map(
      (seg) =>
        `<line class="fit" x1="${X(seg.start)}" x2="${X(seg.end)}" y1="${Y(seg.mean)}" y2="${Y(seg.mean)}"/>`,
    )
    .join("");
  svg += r.breakpoints
    .map(
      (i) =>
        `<line class="boundary" x1="${X(i)}" x2="${X(i)}" y1="40" y2="330"/>`,
    )
    .join("");
  $("plot").innerHTML = svg;
  $("sweep").innerHTML = report.sweep
    .map(
      (x) =>
        `<button class="sweep-row ${x.penalty === report.input.penalty ? "active" : ""}" data-penalty="${x.penalty}"><span>λ ${fmt(x.penalty)}</span><span>${x.segments} segments</span><span>SSE ${fmt(x.sse)}</span></button>`,
    )
    .join("");
  $("selected-title").textContent = `[${s.start}, ${s.end})`;
  $("selected-details").innerHTML =
    `<dt>Observations</dt><dd>${s.count}</dd><dt>Mean</dt><dd>${fmt(s.mean)}</dd><dt>Residual sum of squares</dt><dd>${fmt(s.sse)}</dd><dt>Root mean squared residual</dt><dd>${fmt(Math.sqrt(s.sse / s.count))}</dd>`;
  $("ledger").innerHTML = r.segments
    .map(
      (s) =>
        `<tr><td>${s.start}</td><td>${s.end}</td><td>${s.count}</td><td>${fmt(s.mean)}</td><td>${fmt(s.sse)}</td></tr>`,
    )
    .join("");
}
function settings(values) {
  return {
    values,
    penalty: Number($("penalty").value),
    minLength: Number($("minimum").value),
  };
}
$("settings").onsubmit = (e) => {
  e.preventDefault();
  run(settings(report?.input.values ?? example.values));
};
$("reset").onclick = () => run(example);
$("apply").onclick = () => {
  try {
    run(settings(JSON.parse($("values").value)));
  } catch (error) {
    $("message").textContent = error.message;
  }
};
$("sweep").onclick = (e) => {
  const target = e.target.closest("[data-penalty]");
  if (target) run({ ...report.input, penalty: Number(target.dataset.penalty) });
};
function choose(target) {
  if (worker) return;
  if (target) {
    selected = Number(target.dataset.segment);
    render();
  }
}
$("plot").onclick = (e) => choose(e.target.closest("[data-segment]"));
$("plot").onkeydown = (e) => {
  if (["Enter", " "].includes(e.key)) {
    e.preventDefault();
    choose(e.target.closest("[data-segment]"));
    $("plot").querySelector(`[data-segment="${selected}"]`)?.focus();
  }
};
function download(name, value, type = "application/json") {
  const url = URL.createObjectURL(
      new Blob(
        [type === "application/json" ? JSON.stringify(value, null, 2) : value],
        { type },
      ),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("export").onclick = () =>
  download("shift-study-evidence.json", {
    ...report,
    selectedSegment: selected,
  });
$("save").onclick = () => download("shift-study-input.json", report.input);
$("csv").onclick = () =>
  download(
    "shift-study-fit.csv",
    [
      "index,observed,fitted,residual",
      ...report.input.values.map((v, i) =>
        [i, v, report.fitted[i], report.residuals[i]].join(","),
      ),
    ].join("\r\n") + "\r\n",
    "text/csv",
  );
$("open").onclick = () => $("file").click();
$("file").onchange = async () => {
  try {
    const file = $("file").files[0];
    if (!file) return;
    if (file.size > 100000) throw Error("Study files must be under 100 KB.");
    run(JSON.parse(await file.text()));
  } catch (error) {
    $("message").textContent = error.message;
  } finally {
    $("file").value = "";
  }
};
run(example);
