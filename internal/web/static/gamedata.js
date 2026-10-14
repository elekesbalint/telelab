import { initNav, escapeHtml } from "./nav.js";
import { mountFeedPick, preferredFeedPort } from "./feed-pick.js";

const $ = (id) => document.getElementById(id);
const me = await initNav();
if (!me) throw new Error("auth");
mountFeedPick($("feed-pick"), { preferredPort: preferredFeedPort(me.udpPort ?? null) }).refresh();

const DISPLAY = {
  0: "Australia", 2: "China", 3: "Bahrain", 4: "Spain", 5: "Monaco", 6: "Canada",
  7: "Great Britain", 9: "Hungary", 10: "Belgium", 11: "Monza", 12: "Singapore",
  13: "Japan", 14: "Abu Dhabi", 15: "United States", 16: "Brazil", 17: "Austria",
  19: "Mexico", 20: "Azerbaijan", 26: "Netherlands", 27: "Imola", 29: "Saudi Arabia",
  30: "Miami", 31: "Las Vegas", 32: "Qatar",
  39: "Silverstone (Reverse)", 40: "Austria (Reverse)", 41: "Zandvoort (Reverse)", 42: "Madrid",
};
const GROUPS = [
  { title: "Circuits 1–9", ids: [0, 2, 13, 3, 29, 30, 5] },
  { title: "Circuits 9–16", ids: [4, 6, 17, 7, 10, 9, 26, 11] },
  { title: "Circuits 17–24", ids: [20, 12, 15, 19, 16, 31, 32, 14, 42] },
  { title: "Reverse layouts", ids: [39, 40, 41] },
  { title: "Other circuits", ids: [27] },
];
const FALLBACK = {
  0: ["C3", "C4", "C5"], 2: ["C2", "C3", "C4"], 13: ["C1", "C2", "C3"], 3: ["C1", "C2", "C3"],
  29: ["C3", "C4", "C5"], 30: ["C3", "C4", "C5"], 5: ["C3", "C4", "C5"],
  4: ["C2", "C3", "C4"], 6: ["C3", "C4", "C5"], 17: ["C3", "C4", "C5"], 7: ["C1", "C2", "C3"],
  10: ["C2", "C3", "C4"], 9: ["C3", "C4", "C5"], 26: ["C2", "C3", "C4"], 11: ["C3", "C4", "C5"],
  20: ["C3", "C4", "C5"], 12: ["C3", "C4", "C5"], 15: ["C1", "C3", "C4"], 19: ["C3", "C4", "C5"],
  16: ["C2", "C3", "C4"], 31: ["C3", "C4", "C5"], 32: ["C1", "C2", "C3"], 14: ["C3", "C4", "C5"], 42: ["C3", "C4", "C5"],
  39: ["C1", "C2", "C3"], 40: ["C3", "C4", "C5"], 41: ["C2", "C3", "C4"], 27: ["C3", "C4", "C5"],
};

const GRIP_TEMPS = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120];
const GRIP_COLS = ["C1", "C2", "C3", "C4", "C5", "C6", "Inter", "Wet"];
const GRIP = [
  [94.35, 94.74, 95.05, 96.00, 96.50, 98.35, 99.50, 99.65],
  [94.85, 95.33, 95.70, 97.00, 97.50, 98.80, 99.70, 99.80],
  [95.52, 96.17, 96.80, 97.88, 98.35, 99.15, 99.85, 99.95],
  [96.20, 97.00, 97.80, 98.75, 99.20, 99.50, 100.00, 100.00],
  [96.85, 97.75, 98.38, 99.30, 99.80, 99.75, 100.00, 99.85],
  [97.50, 98.50, 99.25, 99.85, 100.00, 100.00, 100.00, 99.70],
  [98.25, 99.05, 99.63, 99.92, 100.00, 99.80, 99.80, 99.50],
  [99.00, 99.60, 100.00, 100.00, 99.80, 99.60, 99.60, 99.30],
  [99.50, 99.80, 100.00, 99.92, 99.80, 99.60, 99.35, 99.05],
  [100.00, 100.00, 99.85, 99.84, 99.80, 99.40, 99.10, 98.80],
  [100.00, 99.90, 99.83, 98.57, 99.30, 99.05, 98.80, 98.50],
  [100.00, 99.80, 99.65, 99.30, 99.00, 98.70, 98.50, 98.20],
  [99.82, 99.60, 99.38, 99.00, 98.67, 98.45, 98.20, 97.85],
  [99.65, 99.40, 99.10, 98.70, 98.35, 98.10, 97.90, 97.50],
  [99.58, 99.20, 99.00, 98.40, 98.05, 97.87, 97.55, 97.15],
];
const ENGINE = [
  [338.15, 65, 98.00], [348.15, 75, 97.00], [358.15, 85, 98.00],
  [368.15, 95, 99.00], [378.15, 105, 99.70], [388.15, 115, 100.00],
  [398.15, 125, 100.00], [408.15, 135, 99.50], [418.15, 145, 94.00],
  [428.15, 155, 91.00], [438.15, 165, 88.50], [448.15, 175, 85.00],
];

let data = { compounds: [], pits: [], fuel: [], wear: [], drivers: [] };
let tab = new URLSearchParams(location.search).get("tab") || "comp";
let driver = "";

function pill(kind, c) {
  if (!c) return `<span class="dv-muted">–</span>`;
  return `<span class="gd-${kind}">${kind.toUpperCase()}(${escapeHtml(c)})</span>`;
}

function fmtSec(ms) {
  if (ms == null) return "–";
  return `${(ms / 1000).toFixed(3)}s`;
}
function fmtKg(v) {
  if (v == null) return "–";
  return `${Number(v).toFixed(2)} kg`;
}

function gripClass(v) {
  if (v >= 99.7) return "peak";
  if (v >= 99.3) return "opt";
  if (v >= 98.5) return "ok";
  return "low";
}
function engClass(v) {
  if (v >= 100) return "peak";
  if (v >= 99) return "opt";
  if (v >= 94) return "ok";
  return "low";
}

function capturedMap() {
  const m = {};
  for (const c of data.compounds || []) m[c.trackId] = c;
  return m;
}

function renderComp() {
  const cap = capturedMap();
  const cols = GROUPS.map((g) => {
    const rows = g.ids.map((id) => {
      const fb = FALLBACK[id] || [];
      const c = cap[id];
      const h = c?.h || fb[0], m = c?.m || fb[1], s = c?.s || fb[2];
      return `<div class="gd-row"><span>${escapeHtml(DISPLAY[id] || `#${id}`)}</span><span>${pill("h", h)} ${pill("m", m)} ${pill("s", s)}</span></div>`;
    }).join("");
    return `<section class="panel gd-col"><h2>${escapeHtml(g.title)}</h2>${rows}</section>`;
  }).join("");
  return `<h2 class="gd-title">F1 circuit tyre compounds</h2>
    <p class="dv-muted">Hard / Medium / Soft — C-number allocation per track. Pulled from your team’s captured race and quali data; tracks not yet captured fall back to Pirelli’s published 2026 allocation. Reverse layouts start from their forward circuit until you run laps on them.</p>
    <div class="gd-comp">${cols}</div>`;
}

function renderGrip() {
  const head = `<th>Temperature (°C)</th>${GRIP_COLS.map((c) => `<th>${c} grip (%)</th>`).join("")}`;
  const body = GRIP_TEMPS.map((t, i) => `<tr><th>${t}°C</th>${GRIP[i].map((v) => `<td class="gd-heat ${gripClass(v)}">${v.toFixed(2)}</td>`).join("")}</tr>`).join("");
  return `<h2 class="gd-title">Tyre grip performance by temperature</h2>
    <div class="table-wrap"><table class="gd-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="hint">Green = peak grip (≥99.7%). Dark green = optimal (≥99.3%). Amber = usable (&lt;98.5%). Target the coloured band to extract the maximum lap time from the compound.</p>`;
}

function renderEng() {
  const rows = ENGINE.map(([k, c, p]) =>
    `<tr><td>${k.toFixed(2)} K</td><td>${c}°C</td><td class="gd-heat ${engClass(p)}">${p.toFixed(2)}%</td></tr>`
  ).join("");
  return `<h2 class="gd-title">Engine power output by temperature</h2>
    <div class="table-wrap"><table class="gd-table gd-eng"><thead><tr><th>Temperature (K)</th><th>Temperature (°C)</th><th>Engine power (%)</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">Peak power lands in the 115–125°C window. Outside that range you are leaking horsepower on the table or pushing the engine into thermal decay.</p>`;
}

function pitFilters() {
  const opts = [`<option value="">All drivers</option>`].concat(
    (data.drivers || []).map((n) => `<option${n === driver ? " selected" : ""}>${escapeHtml(n)}</option>`)
  );
  return `<div class="gd-filters">
    <span>Scope: your team</span>
    <label>Driver <select id="drv">${opts.join("")}</select></label>
  </div>`;
}

function renderPits() {
  const rows = (data.pits || []).map((p) => `<tr>
    <td class="name">${escapeHtml(p.name)}</td>
    <td>${p.laneN || "–"}</td>
    <td class="gd-heat opt">${fmtSec(p.laneMed)}</td>
    <td>${fmtSec(p.laneAvg)}</td><td>${fmtSec(p.laneMin)}</td><td>${fmtSec(p.laneMax)}</td>
    <td>${p.secN || "–"}</td>
    <td class="gd-heat opt">${fmtSec(p.secMed)}</td>
    <td>${fmtSec(p.secAvg)}</td><td>${fmtSec(p.secMin)}</td><td>${fmtSec(p.secMax)}</td>
  </tr>`).join("") || `<tr><td colspan="11">No captured pit stops yet. Drive a race with UDP on and this table fills in from your team’s pit-lane times.</td></tr>`;
  return `<h2 class="gd-title">Pit loss times (online sessions)</h2>
    <p class="dv-muted">Measured from pit lane <b>entry line to exit line</b>. Only clean stops (8–65 s in lane) are counted. The sector measure is the engineer-verified full pit loss (S3 on the in-lap − S3 on the lap before) + (S1 on the out-lap − S1 on the lap after) — the slowdown into and back up to racing speed, not just the stopwatch in the lane.</p>
    ${pitFilters()}
    <div class="table-wrap"><table class="gd-table">
      <thead>
        <tr><th rowspan="2">Track</th><th colspan="5">Pit entry line → pit exit line</th><th colspan="5">Sector-measured full pit loss</th></tr>
        <tr><th>Samples</th><th>Median</th><th>Average</th><th>Min</th><th>Max</th><th>Samples</th><th>Median</th><th>Average</th><th>Min</th><th>Max</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function renderFuel() {
  const rows = (data.fuel || []).map((f) => `<tr>
    <td class="name">${escapeHtml(f.name)}</td><td>${f.samples}</td>
    <td class="gd-heat opt">${fmtKg(f.medianKg)}</td>
    <td>${fmtKg(f.avgKg)}</td><td>${fmtKg(f.minKg)}</td><td>${fmtKg(f.maxKg)}</td>
  </tr>`).join("") || `<tr><td colspan="6">No captured fuel samples yet. Player-car telemetry fills this in after completed laps.</td></tr>`;
  return `<h2 class="gd-title">Fuel used</h2>
    <p class="dv-muted">Kilograms used per completed player lap, from tank samples. Filtered to 0.3–4.0 kg/lap so in-laps and flashbacks stay out.</p>
    ${pitFilters()}
    <div class="table-wrap"><table class="gd-table">
      <thead><tr><th>Track</th><th>Samples</th><th>Median</th><th>Average</th><th>Min</th><th>Max</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

function renderWear() {
  const rows = (data.wear || []).map((w) => `<tr>
    <td class="name">${escapeHtml(w.name)}</td>
    <td>${escapeHtml(w.compound)}</td>
    <td>${w.samples}</td>
    <td class="gd-heat opt">${w.medianPct != null ? `${Number(w.medianPct).toFixed(2)}% / lap` : "–"}</td>
  </tr>`).join("") || `<tr><td colspan="4">No captured wear samples yet. TeleLab now stores player tyre wear at the end of each lap; older sessions stay empty.</td></tr>`;
  return `<h2 class="gd-title">Tyre wear</h2>
    <p class="dv-muted">Peak-corner wear gained per player lap, grouped by track and visual compound.</p>
    ${pitFilters()}
    <div class="table-wrap"><table class="gd-table">
      <thead><tr><th>Track</th><th>Compound</th><th>Samples</th><th>Median wear</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

const RENDER = { comp: renderComp, grip: renderGrip, eng: renderEng, pits: renderPits, fuel: renderFuel, wear: renderWear };

function paint() {
  $("tabs").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $("view").innerHTML = (RENDER[tab] || renderComp)();
  const drv = $("drv");
  if (drv) drv.onchange = async () => { driver = drv.value; await load(); };
}

async function load() {
  const q = driver ? `?driver=${encodeURIComponent(driver)}` : "";
  data = await (await fetch(`/api/gamedata${q}`)).json().catch(() => data);
  paint();
}

$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  tab = b.dataset.tab;
  const u = new URL(location.href);
  u.searchParams.set("tab", tab);
  history.replaceState(null, "", u);
  paint();
});

load();
