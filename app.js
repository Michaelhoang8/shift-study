import { example } from "./core.js";
const $ = (id) => document.getElementById(id),
  fmt = (x) => Number(x.toPrecision(7)).toString();
let report = null,
  selected = 0,
  worker = null,
  plottedReport = null;
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
  if (plottedReport !== report) {
    let svg = `<defs><linearGradient id="region-wash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7655e5" stop-opacity=".14"/><stop offset="1" stop-color="#7655e5" stop-opacity=".02"/></linearGradient></defs>`;
    svg += Array.from({ length: 6 }, (_, i) => {
      const y = 65 + i * 50;
      return `<line class="grid-line" x1="60" x2="1060" y1="${y}" y2="${y}"/><text x="8" y="${y + 4}">${fmt(low + span - (span * i) / 5)}</text>`;
    }).join("");
    svg += `<text x="60" y="355">0</text><text x="1010" y="355">${n - 1}</text><rect id="selection-wash" x="0" y="40" width="0" height="290" fill="url(#region-wash)"/>`;
    svg += r.segments
      .map(
        (seg, i) =>
          `<rect class="region" x="${X(seg.start)}" y="40" width="${X(seg.end) - X(seg.start)}" height="290" tabindex="0" role="button" data-segment="${i}" aria-label="Segment ${i + 1}, indices ${seg.start} to ${seg.end - 1}, mean ${fmt(seg.mean)}"/>`,
      )
      .join("");
    svg += `<path class="observation" d="${report.input.values.map((v, i) => `${i ? "L" : "M"}${X(i + 0.5)},${Y(v)}`).join(" ")}"/>`;
    svg += r.segments
      .map(
        (seg) =>
          `<line class="fit" pathLength="1" x1="${X(seg.start)}" x2="${X(seg.end)}" y1="${Y(seg.mean)}" y2="${Y(seg.mean)}"/><circle class="level-dot" cx="${X(seg.start)}" cy="${Y(seg.mean)}" r="4"/>`,
      )
      .join("");
    svg += r.breakpoints
      .map(
        (i) =>
          `<line class="boundary" x1="${X(i)}" x2="${X(i)}" y1="40" y2="330"/><text class="boundary-label" x="${X(i) + 8}" y="28">${i}</text>`,
      )
      .join("");
    $("plot").innerHTML = svg;
    plottedReport = report;
  }
  const wash = $("selection-wash");
  wash.style.transform = `translateX(${X(s.start)}px)`;
  wash.style.width = `${X(s.end) - X(s.start)}px`;
  for (const region of $("plot").querySelectorAll("[data-segment]")) {
    const active = Number(region.dataset.segment) === selected;
    region.classList.toggle("selected", active);
    region.setAttribute("aria-pressed", String(active));
  }
  $("sweep").innerHTML = report.sweep
    .map(
      (x) =>
        `<button class="sweep-row ${x.penalty === report.input.penalty ? "active" : ""}" data-penalty="${x.penalty}"><span>λ ${fmt(x.penalty)}</span><strong>${x.segments}<small> segments</small></strong><span>SSE ${fmt(x.sse)}</span></button>`,
    )
    .join("");
  for (const [i, item] of [...$("sweep").children].entries()) {
    const max = Math.max(...report.sweep.map((x) => x.segments));
    item.style.setProperty(
      "--level",
      `${(100 * report.sweep[i].segments) / max}%`,
    );
    item.setAttribute(
      "aria-pressed",
      String(report.sweep[i].penalty === report.input.penalty),
    );
  }
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
