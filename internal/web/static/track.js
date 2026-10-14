import { initNav, escapeHtml } from "./nav.js";
import { mountFeedPick, preferredFeedPort } from "./feed-pick.js";
import { fmtLap, fmtDelta, COMPOUND, COMPOUND_NAME } from "./fmt.js";
import { SETUP_ROWS, fmtSetup, bindSetupModal } from "./setup.js";

const $ = (id) => document.getElementById(id);
const me = await initNav();
if (!me) throw new Error("auth");
mountFeedPick($("feed-pick"), { preferredPort: preferredFeedPort(me.udpPort ?? null) }).refresh();

const id = Number(new URLSearchParams(location.search).get("id"));
const SETUP_KIND = {
  "quali-dry": "Quali (dry)", "race-dry": "Race (dry)",
  "quali-wet": "Quali (wet)", "race-wet": "Race (wet)",
};

function pills(ids) {
  return (ids || []).map((v) =>
    `<span class="tt-tyre-pill" style="--c:${COMPOUND[v] || "var(--line)"}">${escapeHtml((COMPOUND_NAME[v] || "?")[0])}</span>`
  ).join(" ");
}
function dropPct(x) {
  if (x == null) return "–";
  const p = x * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
}
function dropMs(c) {
  if (c.dropOff == null || !c.medianMs) return "–";
  const ms = c.medianMs * c.dropOff;
  return `${ms >= 0 ? "+" : ""}${ms.toFixed(1)} ms/lap`;
}

const d = await (await fetch(`/api/tracks/${id}`)).json().catch(() => null);
if (!d || d.trackId == null) {
  $("title").textContent = "Track not found";
  throw new Error("not found");
}
document.title = `${d.name} · TeleLab`;
$("title").textContent = d.name;

$("kpis").innerHTML = [
  ["Valid laps", d.validLaps],
  ["Sessions", d.sessions],
  ["Drivers", d.drivers],
  ["Best lap", `${fmtLap(d.bestLapMs)}${d.bestDriver ? `<small>by ${escapeHtml(d.bestDriver)}${d.bestAt ? ` · ${new Date(d.bestAt).toLocaleDateString("en-GB")}` : ""}</small>` : ""}`],
  ["Median lap", fmtLap(d.medianLapMs)],
].map(([k, v]) => `<div class="trk-kpi"><span>${k}</span><b>${v}</b></div>`).join("");

const drivers = [...new Set((d.races || []).map((r) => r.player).filter(Boolean))].sort();
$("driver").innerHTML = `<option value="">All drivers</option>` + drivers.map((n) => `<option>${escapeHtml(n)}</option>`).join("");
$("sess").innerHTML = `<option value="">All sessions</option>` + (d.races || []).map((r) =>
  `<option value="${r.sessionId}">${escapeHtml(r.player)} · ${new Date(r.date).toLocaleDateString("en-GB")}</option>`
).join("");

let pct = 50;
let selected = null;

function filteredRaces() {
  let rows = [...(d.races || [])];
  const who = $("driver").value;
  const sid = $("sess").value;
  if (who) rows = rows.filter((r) => r.player === who);
  if (sid) rows = rows.filter((r) => String(r.sessionId) === sid);
  if (pct !== "all") {
    const n = Math.max(1, Math.ceil(rows.length * (Number(pct) / 100)));
    rows = rows.slice(0, n);
  }
  return rows;
}

function renderRaces() {
  const rows = filteredRaces();
  const best = rows[0]?.raceMs;
  $("races").innerHTML = rows.map((r, i) => `
    <tr data-row="${r.sessionId}" class="${selected === r.sessionId ? "active" : ""}">
      <td>${i + 1}</td>
      <td class="name">${escapeHtml(r.player || "?")}</td>
      <td>${fmtLap(r.raceMs)}</td>
      <td>${i === 0 || best == null ? "–" : fmtDelta(r.raceMs - best)}</td>
      <td class="trk-strat">${pills(r.strategy)}</td>
      <td>${r.stops}</td>
      <td>${fmtLap(r.bestLapMs)}</td>
      <td>${r.laps}</td>
      <td>${escapeHtml(r.cond)}</td>
      <td>${new Date(r.date).toLocaleDateString("en-GB")}</td>
      <td class="trk-actions">
        <button type="button" class="ses-btn" data-setup="${r.sessionId}" data-who="${escapeHtml(r.player)}">Setup</button>
        <a class="ses-btn" href="/session.html?id=${r.sessionId}&from=${id}">Review</a>
      </td>
    </tr>`).join("") || `<tr><td colspan="11">No race stints on this track yet.</td></tr>`;
}

function compoundRows(list, extra) {
  return (list || []).map((c) => `
    <tr>
      <td><span class="tt-tyre-pill" style="--c:${COMPOUND[c.visual] || "var(--line)"}">${escapeHtml((c.name || "?")[0])}</span> ${escapeHtml(c.name)}</td>
      ${extra ? `<td>${c.laps}</td>` : ""}
      ${extra ? `<td>${fmtLap(c.bestMs)}</td><td>${fmtLap(c.medianMs)}</td>` : `<td>${fmtLap(c.medianMs)}</td><td>${fmtLap(c.bestMs)}</td>`}
      ${extra ? `<td>${dropPct(c.dropOff)}</td><td>${dropMs(c)}</td><td class="trk-score${c.score === 100 ? " best" : ""}">${c.score ?? "–"}</td>` : `<td>${dropPct(c.dropOff)}</td><td>${c.maxStint || "–"}</td><td>${c.samples}</td>`}
    </tr>`).join("") || `<tr><td colspan="${extra ? 7 : 6}">No compound samples yet.</td></tr>`;
}

$("comp").innerHTML = compoundRows(d.raceCompounds, false);
$("quali").innerHTML = (d.qualiCompounds || []).map((c) => `
  <tr>
    <td><span class="tt-tyre-pill" style="--c:${COMPOUND[c.visual] || "var(--line)"}">${escapeHtml((c.name || "?")[0])}</span> ${escapeHtml(c.name)}</td>
    <td>${c.laps}</td><td>${fmtLap(c.bestMs)}</td><td>${fmtLap(c.medianMs)}</td>
  </tr>`).join("") || `<tr><td colspan="4">No qualifying laps yet.</td></tr>`;
$("race-perf").innerHTML = compoundRows(d.raceCompounds, true);

const comps = [...(d.raceCompounds || []), ...(d.qualiCompounds || [])];
const byName = {};
for (const c of comps) if (!byName[c.name]) byName[c.name] = c;
const names = Object.keys(byName);
$("sim").innerHTML = [1, 2].map((n) => `
  <label>Stint ${n}
    <select data-stint="${n}"><option value="">Choose…</option>${names.map((nm) => `<option>${escapeHtml(nm)}</option>`).join("")}</select>
    <input type="number" min="1" max="80" value="${n === 1 ? 12 : 15}" data-laps="${n}"> laps
  </label>`).join("") + `<button type="button" class="ses-btn ses-btn-primary" id="run">Run simulation</button>
  <button type="button" class="ses-btn" id="add-stint">+ Stint</button>`;

$("run").onclick = () => {
  let total = 0, ok = false, bits = [];
  document.querySelectorAll("[data-stint]").forEach((sel) => {
    const n = sel.dataset.stint;
    const name = sel.value;
    const laps = Number(document.querySelector(`[data-laps="${n}"]`)?.value) || 0;
    if (!name || laps < 1) return;
    const c = byName[name];
    const pace = c?.medianMs || 0;
    const drop = c?.dropOff || 0;
    let st = 0;
    for (let i = 0; i < laps; i++) st += pace * (1 + drop * i);
    total += st;
    ok = true;
    bits.push(`${laps} ${name} (${fmtLap(Math.round(st))})`);
  });
  $("sim-out").textContent = ok ? `Predicted race time ${fmtLap(Math.round(total))} — ${bits.join(" + ")}` : "Pick compounds + stint lengths and click Run simulation.";
};

$("add-stint").onclick = () => {
  const n = document.querySelectorAll("[data-stint]").length + 1;
  const lab = document.createElement("label");
  lab.innerHTML = `Stint ${n}
    <select data-stint="${n}"><option value="">Choose…</option>${names.map((nm) => `<option>${escapeHtml(nm)}</option>`).join("")}</select>
    <input type="number" min="1" max="80" value="12" data-laps="${n}"> laps`;
  $("sim").insertBefore(lab, $("run"));
};

function setupCell(s) {
  if (!s || !s.sessionId) return `<td class="dv-muted">No lap recorded</td>`;
  const when = s.date ? new Date(s.date).toLocaleDateString("en-GB") : "";
  return `<td><b>${escapeHtml(s.driver || "?")}</b><br>${fmtLap(s.lapMs)} ${escapeHtml(SETUP_KIND[s.kind] || "")}<br><small class="dv-muted">${escapeHtml(when)}</small>
    ${s.setup ? `<br><button type="button" class="ses-btn" data-setup="${s.sessionId}" data-who="${escapeHtml(s.driver)}">View</button>` : `<br><span class="dv-muted">No setup</span>`}</td>`;
}

const setups = d.bestSetups || [];
$("setups").innerHTML = `
  <thead><tr><th>Setting</th>${setups.map((s) => `<th>${escapeHtml(SETUP_KIND[s.kind] || s.kind)}</th>`).join("")}</tr></thead>
  <tbody>
    <tr><td>Driver</td>${setups.map(setupCell).join("")}</tr>
    ${SETUP_ROWS.map(([lab, k]) => `<tr><td>${lab}</td>${setups.map((s) => `<td>${s.setup ? fmtSetup(s.setup[k], k) : "–"}</td>`).join("")}</tr>`).join("")}
  </tbody>`;

bindSetupModal();

$("races").addEventListener("click", async (e) => {
  if (e.target.closest("[data-setup], a")) return;
  const tr = e.target.closest("tr[data-row]");
  if (!tr) return;
  selected = Number(tr.dataset.row);
  renderRaces();
  const laps = await (await fetch(`/api/sessions/${selected}/laps`)).then((r) => r.ok ? r.json() : []);
  const mine = laps.filter((l) => l.isPlayer).sort((a, b) => a.lapNum - b.lapNum);
  $("explorer-hint").hidden = true;
  $("explorer-wrap").hidden = false;
  $("explorer").innerHTML = mine.map((l) => `
    <tr class="${l.valid ? "" : "invalid"}">
      <td>${l.lapNum}</td>
      <td>${pills([l.tyreVisual])}</td>
      <td>${fmtLap(l.lapTimeMs)}</td>
      <td>${fmtLap(l.s1Ms)}</td>
      <td>${fmtLap(l.s2Ms)}</td>
      <td>${fmtLap(l.s3Ms)}</td>
      <td>${l.valid ? "" : "invalid"}</td>
    </tr>`).join("") || `<tr><td colspan="7">No player laps in this session.</td></tr>`;
});

$("pct").addEventListener("click", (e) => {
  const b = e.target.closest("[data-pct]");
  if (!b) return;
  pct = b.dataset.pct === "all" ? "all" : Number(b.dataset.pct);
  $("pct").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  renderRaces();
});
$("driver").onchange = renderRaces;
$("sess").onchange = renderRaces;
renderRaces();
