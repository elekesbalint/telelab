import { initNav, escapeHtml } from "./nav.js";
import { mountFeedPick, preferredFeedPort } from "./feed-pick.js";
import { fmtLap, fmtDelta } from "./fmt.js";

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
function dateLbl(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function bestOf(rows, k) {
  const xs = rows.filter((r) => r[k] > 0).map((r) => r[k]);
  return xs.length ? Math.min(...xs) : 0;
}
function cls(v, b) { return v && b && v === b ? "purple" : ""; }

function viewBtns(r) {
  if (!r.lapTimeMs) return "—";
  return `${r.hasSamples
    ? `<a class="ses-btn" href="/compare.html?a=${r.sessionId}:${r.lapNum}">Inputs</a>`
    : `<button type="button" class="ses-btn" disabled title="No telemetry stored">Inputs</button>`}
    ${r.hasSetup
    ? `<button type="button" class="ses-btn" data-setup="${r.sessionId}" data-who="${escapeHtml(r.driver)}">Setup</button>`
    : `<button type="button" class="ses-btn" disabled title="No setup stored">Setup</button>`}
    <a class="ses-btn" href="/soon.html?t=Quali%20ERS%20Maps">ERS Map</a>`;
}

function table(rows) {
  const timed = rows.filter((r) => r.lapTimeMs > 0);
  const bLap = bestOf(timed, "lapTimeMs"), b1 = bestOf(timed, "s1Ms"), b2 = bestOf(timed, "s2Ms"), b3 = bestOf(timed, "s3Ms");
  return `<div class="table-wrap"><table class="lb-table">
    <thead><tr>
      <th>#</th><th>Driver</th><th>Lap time</th><th>Gap</th><th>S1</th><th>S2</th><th>S3</th>
      <th>Session</th><th>Date</th><th>View</th>
    </tr></thead>
    <tbody>${rows.map((r) => {
      if (!r.lapTimeMs) {
        return `<tr class="lb-empty">
          <td class="dim">—</td>
          <td class="name">${escapeHtml(r.driver || "?")}</td>
          <td class="lb-none" colspan="7">no time set</td>
          <td class="lb-view dim">—</td>
        </tr>`;
      }
      return `<tr>
        <td>${r.rank}</td>
        <td class="name">${escapeHtml(r.driver || "?")}</td>
        <td class="${cls(r.lapTimeMs, bLap)}">${fmtLap(r.lapTimeMs)}</td>
        <td>${r.rank === 1 ? "" : fmtDelta(r.gapMs)}</td>
        <td class="${cls(r.s1Ms, b1)}">${fmtLap(r.s1Ms)}</td>
        <td class="${cls(r.s2Ms, b2)}">${fmtLap(r.s2Ms)}</td>
        <td class="${cls(r.s3Ms, b3)}">${fmtLap(r.s3Ms)}</td>
        <td><span class="lb-ses quali">${escapeHtml(r.type)}</span>
            <span class="lb-on ${r.online ? "yes" : "no"}">${r.online ? "Online" : "Offline"}</span></td>
        <td>${escapeHtml(dateLbl(r.date))}</td>
        <td class="lb-view">${viewBtns(r)}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
}

let track = "all";
let cache = { groups: [], trackOpts: [] };

function renderChips() {
  const opts = cache.trackOpts || [];
  $("chips").innerHTML = `<button type="button" class="lb-chip${track === "all" ? " on" : ""}" data-track="all">All circuits</button>`
    + opts.map((t) => `<button type="button" class="lb-chip${String(t.id) === track ? " on" : ""}" data-track="${t.id}">${escapeHtml(t.name)}</button>`).join("");
}

function render() {
  const full = $("full").checked;
  $("list").innerHTML = (cache.groups || []).map((g) => {
    const missing = g.total - g.withTime;
    const where = g.name || "this circuit";
    const mode = full ? "Q1–Q3 and Short Q" : "Short Q only";
    const sum = track === "all"
      ? `${g.withTime} driver${g.withTime === 1 ? "" : "s"} with a time · ${mode}`
      : `${g.withTime} of ${g.total} drivers have a time at ${where}. ${missing} drivers have not set one yet. Showing ${mode}.`;
    return `<section class="lb-track">
      <h2>${escapeHtml(g.name)}</h2>
      <p class="lb-sum">${escapeHtml(sum)}</p>
      ${g.rows?.length ? table(g.rows) : `<p class="dv-muted">No qualifying laps here yet.</p>`}
    </section>`;
  }).join("") || `<p class="dv-muted">No qualifying laps yet. Complete a Short Q with UDP on.</p>`;
}

async function load() {
  const p = new URLSearchParams();
  if (track !== "all") p.set("track", track);
  if ($("full").checked) p.set("full", "1");
  if ($("online").value) p.set("online", $("online").value);
  cache = await (await fetch(`/api/leaderboard/quali?${p}`)).json().catch(() => cache);
  renderChips();
  render();
}

$("chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-track]");
  if (!b) return;
  track = b.dataset.track;
  load();
});
$("refresh").onclick = load;
$("full").addEventListener("change", load);
$("online").addEventListener("change", load);

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
