import { initNav, escapeHtml } from "./nav.js";
import { mountFeedPick, preferredFeedPort } from "./feed-pick.js";
import { fmtLap, fmtDelta, COMPOUND, COMPOUND_NAME } from "./fmt.js";

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
function tyre(v) {
  const name = COMPOUND_NAME[v] || "";
  return `<span class="lb-tyre" style="--c:${COMPOUND[v] || "var(--line)"}">${escapeHtml(name || "–")}</span>`;
}
function dateLbl(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function bestOf(rows, k) {
  const xs = rows.filter((r) => r[k] > 0).map((r) => r[k]);
  return xs.length ? Math.min(...xs) : 0;
}
function cls(v, b) { return v && b && v === b ? "purple" : ""; }

function table(rows) {
  if (!rows?.length) return "";
  const bLap = bestOf(rows, "lapTimeMs"), b1 = bestOf(rows, "s1Ms"), b2 = bestOf(rows, "s2Ms"), b3 = bestOf(rows, "s3Ms");
  return `<div class="table-wrap"><table class="lb-table">
    <thead><tr>
      <th>#</th><th>Driver</th><th>Lap time</th><th>Gap</th><th>S1</th><th>S2</th><th>S3</th>
      <th>Tyre</th><th>Session</th><th>Date</th><th>View</th>
    </tr></thead>
    <tbody>${rows.map((r) => `
      <tr>
        <td>${r.rank}</td>
        <td class="name">${escapeHtml(r.driver || "?")}</td>
        <td class="${cls(r.lapTimeMs, bLap)}">${fmtLap(r.lapTimeMs)}</td>
        <td>${r.rank === 1 ? "" : fmtDelta(r.gapMs)}</td>
        <td class="${cls(r.s1Ms, b1)}">${fmtLap(r.s1Ms)}</td>
        <td class="${cls(r.s2Ms, b2)}">${fmtLap(r.s2Ms)}</td>
        <td class="${cls(r.s3Ms, b3)}">${fmtLap(r.s3Ms)}</td>
        <td>${tyre(r.tyreVisual)}</td>
        <td><span class="lb-ses ${r.sessionType >= 15 ? "race" : "quali"}">${escapeHtml(r.type)}</span>
            <span class="lb-on ${r.online ? "yes" : "no"}">${r.online ? "Online" : "Offline"}</span></td>
        <td>${escapeHtml(dateLbl(r.date))}</td>
        <td class="lb-view">
          ${r.hasSamples
            ? `<a class="ses-btn" href="/compare.html?a=${r.sessionId}:${r.lapNum}">Inputs</a>`
            : `<button type="button" class="ses-btn" disabled title="No telemetry stored">Inputs</button>`}
          ${r.hasSetup
            ? `<button type="button" class="ses-btn" data-setup="${r.sessionId}" data-who="${escapeHtml(r.driver)}">Setup</button>`
            : `<button type="button" class="ses-btn" disabled title="No setup stored">Setup</button>`}
          <a class="ses-btn" href="/soon.html?t=${r.sessionType >= 15 ? "Race" : "Quali"}%20ERS%20Maps">ERS Map</a>
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

let cache = { tracks: [], drivers: [], types: [] };

function render() {
  const kind = $("kind").value;
  $("list").innerHTML = (cache.tracks || []).map((t) => {
    const q = kind === "race" ? [] : t.quali;
    const r = kind === "quali" ? [] : t.race;
    if (!q.length && !r.length) return "";
    return `<section class="lb-track">
      <h2>${escapeHtml(t.name)}</h2>
      ${q.length ? `<h3>Qualifying</h3>${table(q)}` : ""}
      ${r.length ? `<h3>Race</h3>${table(r)}` : ""}
    </section>`;
  }).join("") || `<p class="dv-muted">No valid laps yet. Complete a qualifying or race lap with UDP on.</p>`;
}

async function load() {
  const p = new URLSearchParams();
  if ($("kind").value !== "both") p.set("kind", $("kind").value);
  if ($("track").value !== "") p.set("track", $("track").value);
  if ($("q").value.trim()) p.set("q", $("q").value.trim());
  if ($("stype").value) p.set("type", $("stype").value);
  if ($("tyre").value) p.set("tyre", $("tyre").value);
  if ($("driver").value) p.set("driver", $("driver").value);
  cache = await (await fetch(`/api/leaderboard/laps?${p}`)).json().catch(() => cache);
  const keep = {
    track: $("track").value, stype: $("stype").value, tyre: $("tyre").value, driver: $("driver").value,
  };
  opts($("track"), (cache.trackOpts || cache.tracks || []).map((t) => ({ v: t.id ?? t.trackId, t: t.name })), "All tracks", keep.track);
  opts($("stype"), cache.types || [], "All sessions", keep.stype);
  opts($("tyre"), [
    { v: 16, t: "Soft" }, { v: 17, t: "Medium" }, { v: 18, t: "Hard" }, { v: 7, t: "Intermediate" }, { v: 8, t: "Wet" },
  ], "All tyres", keep.tyre);
  opts($("driver"), cache.drivers || [], "All drivers", keep.driver);
  render();
}

$("refresh").onclick = load;
["kind", "track", "stype", "tyre", "driver"].forEach((id) => $(id).addEventListener("change", load));
let t;
$("q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 250); });

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
