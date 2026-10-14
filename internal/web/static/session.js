import { initNav, escapeHtml } from "./nav.js";
import { mountFeedPick, preferredFeedPort } from "./feed-pick.js";
import { fmtLap, COMPOUND, COMPOUND_NAME, RESULT_NAME, teamColor, teamName } from "./fmt.js";

const $ = (id) => document.getElementById(id);
const me = await initNav();
if (!me) throw new Error("auth");
mountFeedPick($("feed-pick"), { preferredPort: preferredFeedPort(me.udpPort ?? null) }).refresh();

const params = new URLSearchParams(location.search);
const id = params.get("id");
const fromTrack = params.get("from");
$("back").href = fromTrack ? `/track.html?id=${fromTrack}` : "/sessions.html";

const isRace = (t) => t >= 15 && t <= 17;
const isQuali = (t) => t >= 5 && t <= 14;

const [ses, laps, fuelRows] = await Promise.all([
  fetch(`/api/sessions/${id}`).then((r) => (r.ok ? r.json() : null)),
  fetch(`/api/sessions/${id}/laps`).then((r) => (r.ok ? r.json() : [])),
  fetch(`/api/sessions/${id}/fuel`).then((r) => (r.ok ? r.json() : [])),
]);
if (!ses) { $("title").textContent = "Session not found"; throw new Error("not found"); }

document.title = `${ses.player || "Session"} ${ses.track} · TeleLab`;
$("title").textContent = `${ses.player || "?"} ${ses.track}`;

const fuelByLap = new Map((fuelRows || []).map((f) => [f.lap, f]));
const fieldByIdx = new Map((ses.field || []).map((p) => [p.idx, p]));
const classByIdx = new Map((ses.classification?.cars || []).map((c) => [c.idx, c]));

const byCar = new Map();
for (const l of laps) {
  const c = byCar.get(l.carIdx) ?? {
    carIdx: l.carIdx, driver: l.driver, isPlayer: l.isPlayer, teamId: l.teamId || 0,
    laps: [], best: 0, n: 0, raceMs: 0, strategy: [],
  };
  c.n++;
  c.laps.push(l);
  c.raceMs += l.lapTimeMs || 0;
  if (l.driver) c.driver = l.driver;
  if (l.teamId) c.teamId = l.teamId;
  if (l.isPlayer) c.isPlayer = true;
  if (l.valid && l.lapTimeMs && (!c.best || l.lapTimeMs < c.best)) c.best = l.lapTimeMs;
  const prev = c.strategy[c.strategy.length - 1];
  if (l.tyreVisual && l.tyreVisual !== prev) c.strategy.push(l.tyreVisual);
  byCar.set(l.carIdx, c);
}
for (const p of ses.field || []) {
  if (!byCar.has(p.idx)) {
    byCar.set(p.idx, {
      carIdx: p.idx, driver: p.name, isPlayer: false, teamId: p.teamId || 0,
      laps: [], best: 0, n: 0, raceMs: 0, strategy: [],
    });
  }
}

function pills(ids) {
  return (ids || []).map((v) =>
    `<span class="tt-tyre-pill" style="--c:${COMPOUND[v] || "var(--line)"}">${escapeHtml((COMPOUND_NAME[v] || "?")[0] || "?")}</span>`
  ).join(" ");
}

function rankedCars() {
  const rows = [...byCar.values()];
  const classified = rows.some((r) => classByIdx.get(r.carIdx)?.pos);
  if (classified) {
    rows.sort((a, b) => (classByIdx.get(a.carIdx)?.pos || 99) - (classByIdx.get(b.carIdx)?.pos || 99));
  } else if (isRace(ses.sessionType)) {
    rows.sort((a, b) => (b.n - a.n) || (a.raceMs - b.raceMs));
  } else {
    rows.sort((a, b) => (a.best || 9e9) - (b.best || 9e9));
  }
  return rows.filter((r) => r.n > 0 || classByIdx.has(r.carIdx));
}

function statusOf(row) {
  const cl = classByIdx.get(row.carIdx);
  if (cl?.status != null) return RESULT_NAME[cl.status] || String(cl.status);
  if (ses.totalLaps && row.n >= ses.totalLaps) return "Finished";
  if (isRace(ses.sessionType) && ses.totalLaps && row.n < ses.totalLaps) return "DNF";
  return row.n ? "Finished" : "–";
}

function directorDrivers() {
  const rows = rankedCars();
  return `<div class="table-wrap"><table class="trk-table">
    <thead><tr><th>Pos</th><th>Driver</th><th>Team</th><th>Status</th><th>Grid</th><th>Stops</th><th>Tyres</th></tr></thead>
    <tbody>${rows.map((r, i) => {
      const cl = classByIdx.get(r.carIdx);
      const field = fieldByIdx.get(r.carIdx);
      const teamId = r.teamId || field?.teamId || 0;
      const pos = cl?.pos || i + 1;
      const grid = cl?.grid || "–";
      const stops = cl?.stops ?? Math.max(0, (cl?.tyres || r.strategy).length - 1);
      const tyres = cl?.tyres?.length ? cl.tyres : r.strategy;
      const st = statusOf(r);
      const stCls = st === "Finished" || st === "Active" ? "ok" : (st === "DNF" || st === "Retired" || st === "DSQ" ? "bad" : "");
      return `<tr class="${r.isPlayer ? "me" : ""}">
        <td>${pos}</td>
        <td class="name">${escapeHtml(r.driver || field?.name || "?")}</td>
        <td><span class="tt-team" style="background:${teamColor(teamId)}"></span>${escapeHtml(teamName(teamId))}</td>
        <td class="rev-status ${stCls}">${escapeHtml(st)}</td>
        <td>${grid}</td>
        <td>${stops < 0 ? 0 : stops}</td>
        <td>${pills(tyres)}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="7">No cars in this session.</td></tr>`}</tbody></table></div>`;
}

function directorPits() {
  const rows = rankedCars();
  const lines = [];
  for (const r of rows) {
    let prev = 0;
    for (const l of r.laps) {
      if (prev && l.tyreVisual && l.tyreVisual !== prev) {
        lines.push(`<tr><td>${escapeHtml(r.driver || "?")}</td><td>${l.lapNum}</td><td>${pills([prev])} → ${pills([l.tyreVisual])}</td></tr>`);
      }
      if (l.tyreVisual) prev = l.tyreVisual;
    }
  }
  return `<div class="table-wrap"><table class="trk-table">
    <thead><tr><th>Driver</th><th>Lap</th><th>Change</th></tr></thead>
    <tbody>${lines.join("") || `<tr><td colspan="3">No pit stops inferred from tyre changes.</td></tr>`}</tbody></table></div>`;
}

const DIR_EMPTY = {
  incidents: "Incidents are not stored for review yet — they stay on the live race-control panel.",
  ird: "Individual race director is not stored yet.",
  trace: "Race trace (position by lap) is not stored yet.",
};

function showDirector(tab) {
  $("dir-tabs").querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.tab === tab);
    b.classList.toggle("live", b.dataset.tab === tab);
  });
  if (tab === "drivers") $("director").innerHTML = directorDrivers();
  else if (tab === "pits") $("director").innerHTML = directorPits();
  else $("director").innerHTML = `<p class="rev-empty">${DIR_EMPTY[tab] || ""}</p>`;
}
$("dir-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (b) showDirector(b.dataset.tab);
});
showDirector("drivers");

const playerMs = laps.filter((l) => l.isPlayer).reduce((s, l) => s + (l.lapTimeMs || 0), 0);
const kindLabel = isRace(ses.sessionType) ? "R" : (ses.type || "Session");
const durS = Math.round(playerMs / 1000);
const dur = playerMs ? `${Math.floor(durS / 60)}:${String(durS % 60).padStart(2, "0")}` : "–";
$("banner").textContent = `Finished segments in this session: ${kindLabel} (${dur})`;

const cars = rankedCars();
$("car").innerHTML = cars.map((c) =>
  `<option value="${c.carIdx}"${c.isPlayer ? " selected" : ""}>${escapeHtml(c.driver || `Car ${c.carIdx}`)}${c.isPlayer ? " — player" : ""}</option>`
).join("");

let plots = [];
function destroyPlots() {
  for (const p of plots) try { p.destroy(); } catch {}
  plots = [];
}
function cssVar(v) {
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
}

function paintCharts(mine) {
  destroyPlots();
  const col = cssVar;
  if (!mine.length || typeof uPlot === "undefined") return;
  const xs = mine.map((l) => l.lapNum);
  const valid = mine.map((l) => (l.valid ? l.lapTimeMs / 1000 : null));
  const invalid = mine.map((l) => (l.valid ? null : l.lapTimeMs / 1000));
  const el = $("chart-laps");
  const p1 = new uPlot({
    width: el.clientWidth, height: 200,
    legend: { show: false },
    cursor: { points: { size: 8 } },
    scales: { x: { time: false } },
    axes: [
      { stroke: col("--dim"), grid: { stroke: col("--line"), width: 1 }, incrs: [1, 2, 5, 10] },
      { stroke: col("--dim"), grid: { stroke: col("--line"), width: 1 }, size: 70, values: (_u, v) => v.map((s) => fmtLap(Math.round(s * 1000))) },
    ],
    series: [
      {},
      { stroke: col("--cold"), width: 2, points: { size: 6, fill: col("--cold") }, spanGaps: true },
      { stroke: "transparent", points: { show: true, size: 7, stroke: col("--dim"), fill: col("--panel") } },
    ],
  }, [xs, valid, invalid], el);
  plots.push(p1);
  new ResizeObserver(() => p1.setSize({ width: el.clientWidth, height: 200 })).observe(el);

  const isP = mine.some((l) => l.isPlayer);
  $("fuel-box").hidden = !isP || !fuelByLap.size;
  if (isP && fuelByLap.size) {
    const fuel = mine.map((l) => fuelByLap.get(l.lapNum)?.fuelEnd ?? null);
    const el2 = $("chart-fuel");
    const p2 = new uPlot({
      width: el2.clientWidth, height: 180,
      legend: { show: false },
      scales: { x: { time: false } },
      axes: [
        { stroke: col("--dim"), grid: { stroke: col("--line"), width: 1 }, incrs: [1, 2, 5, 10] },
        { stroke: col("--dim"), grid: { stroke: col("--line"), width: 1 }, size: 50, values: (_u, v) => v.map((s) => `${s.toFixed(1)} kg`) },
      ],
      series: [{}, { stroke: col("--amber"), width: 2, points: { size: 5, fill: col("--amber") }, spanGaps: true }],
    }, [xs, fuel], el2);
    plots.push(p2);
    new ResizeObserver(() => p2.setSize({ width: el2.clientWidth, height: 180 })).observe(el2);
  }
}

function fmtKg(v) {
  if (v == null || Number.isNaN(v)) return "–";
  return `${v.toFixed(2)} kg`;
}
function fmtMJ(j) {
  if (j == null || Number.isNaN(j)) return "–";
  return `${(j / 1e6).toFixed(2)} MJ`;
}

function renderLaps() {
  const idx = Number($("car").value);
  const row = byCar.get(idx);
  const mine = (row?.laps || []).slice().sort((a, b) => a.lapNum - b.lapNum);
  const best = (k) => {
    const xs = mine.filter((l) => l.valid && l[k]).map((l) => l[k]);
    return xs.length ? Math.min(...xs) : 0;
  };
  const bestLap = best("lapTimeMs"), b1 = best("s1Ms"), b2 = best("s2Ms"), b3 = best("s3Ms");
  const cls = (v, b) => (v && v === b ? "purple" : "");
  let tot = 0;
  $("laps").innerHTML = mine.map((l) => {
    tot += l.lapTimeMs || 0;
    const f = fuelByLap.get(l.lapNum);
    const used = f ? Math.max(0, f.fuelStart - f.fuelEnd) : null;
    const batt = f ? Math.max(0, f.ersStart - f.ersEnd) : null;
    const fuelLaps = f && used > 0.01 && l.lapTimeMs ? (f.fuelEnd / used) : null;
    return `<tr class="${l.valid ? "" : "invalid"}">
      <td>${l.lapNum}</td>
      <td>${pills([l.tyreVisual])}</td>
      <td class="${cls(l.lapTimeMs, bestLap)}">${fmtLap(l.lapTimeMs)}</td>
      <td>${fmtLap(tot)}</td>
      <td class="${cls(l.s1Ms, b1)}">${fmtLap(l.s1Ms)}</td>
      <td class="${cls(l.s2Ms, b2)}">${fmtLap(l.s2Ms)}</td>
      <td class="${cls(l.s3Ms, b3)}">${fmtLap(l.s3Ms)}</td>
      <td>${fmtMJ(batt)}</td>
      <td>${fmtKg(used)}</td>
      <td>${fuelLaps != null ? fuelLaps.toFixed(2) : "–"}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="10">No completed laps for this driver.</td></tr>`;
  paintCharts(mine);
  return mine;
}

$("car").addEventListener("change", renderLaps);
$("reset").onclick = () => renderLaps();
$("cmp-drv").onclick = () => {
  const mine = (byCar.get(Number($("car").value))?.laps || []).filter((l) => l.valid).sort((a, b) => a.lapTimeMs - b.lapTimeMs);
  if (!mine[0]) return;
  const q = new URLSearchParams({ a: `${id}:${mine[0].lapNum}` });
  if (mine[1]) q.set("b", `${id}:${mine[1].lapNum}`);
  location.href = `/compare.html?${q}`;
};
$("csv").onclick = () => {
  const idx = Number($("car").value);
  const row = byCar.get(idx);
  const mine = (row?.laps || []).slice().sort((a, b) => a.lapNum - b.lapNum);
  let tot = 0;
  const lines = [["lap", "tyre", "lapTimeMs", "totalMs", "s1", "s2", "s3", "fuelUsedKg", "ersUsedJ"]];
  for (const l of mine) {
    tot += l.lapTimeMs || 0;
    const f = fuelByLap.get(l.lapNum);
    const used = f ? Math.max(0, f.fuelStart - f.fuelEnd) : "";
    const batt = f ? Math.max(0, f.ersStart - f.ersEnd) : "";
    lines.push([l.lapNum, COMPOUND_NAME[l.tyreVisual] || l.tyreVisual, l.lapTimeMs, tot, l.s1Ms, l.s2Ms, l.s3Ms, used, batt]);
  }
  const blob = new Blob([lines.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `telelab-${ses.track || "session"}-${id}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

renderLaps();

const siblings = await fetch(`/api/sessions?track=${ses.trackId}&limit=80`).then((r) => r.ok ? r.json() : []);
const q = new URLSearchParams(location.search);
$("pick").innerHTML = `<option value="">Select a session…</option>` + siblings.map((s) =>
  `<option value="${s.id}"${String(s.id) === String(id) ? " selected" : ""}>${escapeHtml(s.player || "?")} · ${escapeHtml(s.type)} · ${new Date(s.startedAt).toLocaleString("en-GB")}</option>`
).join("");
$("pick").onchange = () => {
  if ($("pick").value) {
    q.set("id", $("pick").value);
    location.search = q.toString();
  }
};

const quali = siblings.find((s) => isQuali(s.sessionType));
const race = siblings.find((s) => isRace(s.sessionType));
$("kind").innerHTML = [
  quali ? `<button type="button" data-id="${quali.id}" class="${isQuali(ses.sessionType) ? "on" : ""}">${escapeHtml(quali.type)}</button>` : "",
  race ? `<button type="button" data-id="${race.id}" class="${isRace(ses.sessionType) ? "on" : ""}">${escapeHtml(race.type)}</button>` : "",
].join("") || `<button type="button" class="on">${escapeHtml(ses.type || "Session")}</button>`;
$("kind").addEventListener("click", (e) => {
  const b = e.target.closest("[data-id]");
  if (b && b.dataset.id !== String(id)) {
    q.set("id", b.dataset.id);
    location.search = q.toString();
  }
});

$("cmp-ses").href = `/sessions.html`;
const bestA = (byCar.get(cars.find((c) => c.isPlayer)?.carIdx)?.laps || []).filter((l) => l.valid).sort((a, b) => a.lapTimeMs - b.lapTimeMs)[0];
if (bestA) $("cmp-ses").href = `/compare.html?a=${id}:${bestA.lapNum}`;
