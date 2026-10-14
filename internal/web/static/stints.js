import { initNav, escapeHtml } from "./nav.js";
import { mountFeedPick, preferredFeedPort } from "./feed-pick.js";
import { fmtLap, fmtDelta, fmtRace, COMPOUND, COMPOUND_NAME } from "./fmt.js";

const $ = (id) => document.getElementById(id);
const me = await initNav();
if (!me) throw new Error("auth");
mountFeedPick($("feed-pick"), { preferredPort: preferredFeedPort(me.udpPort ?? null) }).refresh();

const SETUP_ROWS = [
  ["Front wing aero", "frontWing"], ["Rear wing aero", "rearWing"],
  ["Diff adjustment on throttle", "onThrottle"], ["Diff adjustment off throttle", "offThrottle"], ["Engine braking", "engineBraking"],
  ["Front camber", "frontCamber"], ["Rear camber", "rearCamber"], ["Front toe", "frontToe"], ["Rear toe", "rearToe"],
  ["Front suspension", "frontSusp"], ["Rear suspension", "rearSusp"],
  ["Front anti-roll bar", "frontARB"], ["Rear anti-roll bar", "rearARB"],
  ["Front ride height", "frontHeight"], ["Rear ride height", "rearHeight"],
  ["Brake pressure", "brakePressure"], ["Front brake bias", "brakeBias"],
  ["Front right tyre pressure", "pressFR"], ["Front left tyre pressure", "pressFL"],
  ["Rear right tyre pressure", "pressRR"], ["Rear left tyre pressure", "pressRL"],
];

function fmtNum(v) {
  if (v == null) return "–";
  return typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : String(v);
}
function pills(ids) {
  return (ids || []).map((v) =>
    `<span class="tt-tyre-pill" style="--c:${COMPOUND[v] || "var(--line)"}">${escapeHtml((COMPOUND_NAME[v] || "?")[0] || "?")}</span>`
  ).join(" ");
}
function dateLbl(iso) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}. ${m}. ${day}.`;
}
function gridFin(r) {
  if (!r.grid && !r.finish) return "–";
  return `${r.grid || "–"}→${r.finish || "–"}`;
}

function table(rows) {
  const bRace = rows.length ? Math.min(...rows.map((r) => r.raceMs).filter(Boolean)) : 0;
  const bLap = rows.length ? Math.min(...rows.map((r) => r.bestLapMs).filter(Boolean)) : 0;
  return `<div class="table-wrap"><table class="lb-table">
    <thead><tr>
      <th>#</th><th>Driver</th><th>Race time</th><th>Gap</th><th>Pen</th><th>Strategy</th><th>Stops</th>
      <th>Best lap</th><th>Grid→Fin</th><th>Laps</th><th>Cond</th><th>Date</th><th>Open</th>
    </tr></thead>
    <tbody>${rows.map((r) => `
      <tr>
        <td>${r.rank}</td>
        <td class="name">${escapeHtml(r.driver || "?")}</td>
        <td class="${r.raceMs === bRace ? "purple" : ""}">${fmtRace(r.raceMs)}</td>
        <td>${r.rank === 1 ? "" : fmtDelta(r.gapMs)}</td>
        <td class="${r.pen ? "lb-pen" : "dim"}">${r.pen ? `+${r.pen}s` : "–"}</td>
        <td>${pills(r.strategy)}</td>
        <td>${r.stops ?? 0}</td>
        <td class="${r.bestLapMs === bLap ? "purple" : ""}">${fmtLap(r.bestLapMs)}</td>
        <td>${gridFin(r)}</td>
        <td>${r.laps || "–"}</td>
        <td><span class="lb-cond ${(r.cond || "DRY").toLowerCase()}">${escapeHtml(r.cond || "DRY")}</span></td>
        <td>${escapeHtml(dateLbl(r.date))}</td>
        <td class="lb-view">
          <a class="ses-btn" href="/session.html?id=${r.sessionId}">Review</a>
          ${r.hasSamples && r.bestLapNum
            ? `<a class="ses-btn" href="/compare.html?a=${r.sessionId}:${r.bestLapNum}">Inputs</a>`
            : `<button type="button" class="ses-btn" disabled>Inputs</button>`}
          <a class="ses-btn" href="/soon.html?t=Race%20ERS%20Maps">ERS</a>
          ${r.hasQualiSetup
            ? `<button type="button" class="ses-btn" data-setup="${r.qualiSessionId}" data-who="${escapeHtml(r.driver)}">Setup Q</button>`
            : `<button type="button" class="ses-btn" disabled title="No quali setup">Setup Q</button>`}
          ${r.hasSetup
            ? `<button type="button" class="ses-btn" data-setup="${r.sessionId}" data-who="${escapeHtml(r.driver)}">Setup R</button>`
            : `<button type="button" class="ses-btn" disabled title="No race setup">Setup R</button>`}
        </td>
      </tr>`).join("")}
    </tbody></table></div>`;
}

function opts(sel, items, label, current) {
  sel.innerHTML = `<option value="">${label}</option>` + items.map((x) => {
    const v = typeof x === "object" ? x.v : x;
    const t = typeof x === "object" ? x.t : x;
    return `<option value="${escapeHtml(String(v))}"${String(v) === String(current) ? " selected" : ""}>${escapeHtml(t)}</option>`;
  }).join("");
}

let cache = { tracks: [], drivers: [], trackOpts: [] };

function render() {
  $("list").innerHTML = (cache.tracks || []).map((t) => {
    if (!t.rows?.length) return "";
    return `<section class="lb-track">
      <h2>${escapeHtml(t.name)}</h2>
      ${table(t.rows)}
    </section>`;
  }).join("") || `<p class="dv-muted">No completed 50% races yet. Finish a race with UDP on.</p>`;
}

async function load() {
  const p = new URLSearchParams();
  if ($("track").value !== "") p.set("track", $("track").value);
  if ($("cond").value) p.set("cond", $("cond").value);
  if ($("driver").value) p.set("driver", $("driver").value);
  if ($("online").value) p.set("online", $("online").value);
  cache = await (await fetch(`/api/leaderboard/stints?${p}`)).json().catch(() => cache);
  const keep = { track: $("track").value, driver: $("driver").value };
  opts($("track"), (cache.trackOpts || []).map((t) => ({ v: t.id, t: t.name })), "All tracks", keep.track);
  opts($("driver"), cache.drivers || [], "All drivers", keep.driver);
  render();
}

$("refresh").onclick = load;
["track", "cond", "driver", "online"].forEach((id) => $(id).addEventListener("change", load));

$("list").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-setup]");
  if (!btn) return;
  const ses = await (await fetch(`/api/sessions/${btn.dataset.setup}`)).then((r) => r.ok ? r.json() : null);
  $("modal-title").textContent = `Setup — ${btn.dataset.who || ""}`;
  const su = ses?.setup;
  $("modal-body").innerHTML = su
    ? `<table class="trk-table"><thead><tr><th>Setting</th><th>Value</th></tr></thead><tbody>${SETUP_ROWS.map(([lab, k]) =>
      `<tr><td>${lab}</td><td>${fmtNum(su[k])}</td></tr>`).join("")}</tbody></table>`
    : `<p class="dv-muted">No setup snapshot stored for this session.</p>`;
  $("modal").hidden = false;
});
$("modal-close").onclick = () => { $("modal").hidden = true; };
$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) $("modal").hidden = true; });

load();
