import { initNav, escapeHtml } from "./nav.js";
import { mountFeedPick, preferredFeedPort } from "./feed-pick.js";
import { fmtLap, COMPOUND, COMPOUND_NAME } from "./fmt.js";
import { bindSetupModal } from "./setup.js";

const $ = (id) => document.getElementById(id);
const me = await initNav();
if (!me) throw new Error("auth");
mountFeedPick($("feed-pick"), { preferredPort: preferredFeedPort(me.udpPort ?? null) }).refresh();

function tyre(v) {
  const name = COMPOUND_NAME[v] || "";
  return `<span class="lb-tyre" style="--c:${COMPOUND[v] || "var(--line)"}">${escapeHtml(name || "–")}</span>`;
}
function dateLbl(iso) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function opts(sel, items, label, current) {
  sel.innerHTML = `<option value="">${label}</option>` + items.map((x) => {
    const v = typeof x === "object" ? x.v : x;
    const t = typeof x === "object" ? x.t : x;
    return `<option value="${escapeHtml(String(v))}"${String(v) === String(current) ? " selected" : ""}>${escapeHtml(t)}</option>`;
  }).join("");
}

const FILTER_IDS = ["driver", "track", "stype", "tyre", "lapMin", "lapMax", "s1Min", "s1Max", "s2Min", "s2Max", "s3Min", "s3Max"];

function params() {
  const p = new URLSearchParams();
  if ($("driver").value) p.set("driver", $("driver").value);
  if ($("track").value !== "") p.set("track", $("track").value);
  if ($("stype").value) p.set("type", $("stype").value);
  if ($("tyre").value) p.set("tyre", $("tyre").value);
  for (const id of ["lapMin", "lapMax", "s1Min", "s1Max", "s2Min", "s2Max", "s3Min", "s3Max"]) {
    const v = $(id).value.trim();
    if (v) p.set(id, v);
  }
  return p;
}

let cache = { laps: [], drivers: [], tracks: [], types: [], total: 0 };

function render() {
  const n = cache.laps?.length || 0;
  const total = cache.total || 0;
  $("sum").textContent = total ? `${total} laps found (showing first ${n})` : "No laps match these filters.";
  if (!n) {
    $("list").innerHTML = `<p class="dv-muted">No laps yet. Drive with UDP on, then search here.</p>`;
    return;
  }
  $("list").innerHTML = `<div class="table-wrap"><table class="lb-table tdb-table">
    <thead><tr>
      <th></th><th>Driver</th><th>Track</th><th>Type</th><th>Lap</th><th>Lap time</th>
      <th>S1</th><th>S2</th><th>S3</th><th>Tyre</th><th>Valid</th><th></th>
    </tr></thead>
    <tbody>${cache.laps.map((r) => `
      <tr>
        <td class="dim">${escapeHtml(dateLbl(r.date))}</td>
        <td class="name">${escapeHtml(r.driver || "?")}</td>
        <td><a href="/track.html?id=${r.trackId}">${escapeHtml(r.track)}</a></td>
        <td>${escapeHtml(r.type)}</td>
        <td>${r.lapNum}</td>
        <td>${fmtLap(r.lapTimeMs)}</td>
        <td>${fmtLap(r.s1Ms)}</td>
        <td>${fmtLap(r.s2Ms)}</td>
        <td>${fmtLap(r.s3Ms)}</td>
        <td>${tyre(r.tyreVisual)}</td>
        <td class="${r.valid ? "lb-ok" : "lb-no"}">${r.valid ? "✓" : "✕"}</td>
        <td class="lb-view">
          ${r.hasSamples
            ? `<a class="ses-btn" href="/compare.html?a=${r.sessionId}:${r.lapNum}">Inputs</a>`
            : `<button type="button" class="ses-btn" disabled>Inputs</button>`}
          ${r.hasSetup
            ? `<button type="button" class="ses-btn" data-setup="${r.sessionId}" data-who="${escapeHtml(r.driver)}" data-lap="${r.lapNum}">Setup</button>`
            : `<button type="button" class="ses-btn" disabled>Setup</button>`}
          <a class="ses-btn" href="/session.html?id=${r.sessionId}" title="Session">i</a>
          <button type="button" class="ses-btn lb-del" data-del="${r.sessionId}" data-lap="${r.lapNum}" title="Delete lap">×</button>
        </td>
      </tr>`).join("")}
    </tbody></table></div>`;
}

async function load() {
  cache = await (await fetch(`/api/teamdb/laps?${params()}`)).json().catch(() => cache);
  const keep = {
    driver: $("driver").value, track: $("track").value, stype: $("stype").value, tyre: $("tyre").value,
  };
  opts($("driver"), cache.drivers || [], "All drivers", keep.driver);
  opts($("track"), (cache.tracks || []).map((t) => ({ v: t.id, t: t.name })), "All tracks", keep.track);
  opts($("stype"), (cache.types || []).map((t) => ({ v: t.id, t: t.name })), "All types", keep.stype);
  opts($("tyre"), [
    { v: 16, t: "Soft" }, { v: 17, t: "Medium" }, { v: 18, t: "Hard" }, { v: 7, t: "Intermediate" }, { v: 8, t: "Wet" },
  ], "All tyres", keep.tyre);
  render();
}

$("form").addEventListener("submit", (e) => { e.preventDefault(); load(); });
$("refresh").onclick = load;
$("clear").onclick = () => {
  FILTER_IDS.forEach((id) => { $(id).value = ""; });
  load();
};

$("list").addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del]");
  if (!del) return;
  if (!confirm("Delete this lap from the team database?")) return;
  const res = await fetch(`/api/sessions/${del.dataset.del}/laps/${del.dataset.lap}`, { method: "DELETE" });
  if (!res.ok) {
    alert("Could not delete this lap.");
    return;
  }
  load();
});
bindSetupModal();
load();
