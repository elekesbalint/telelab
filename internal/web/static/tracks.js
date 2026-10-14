import { initNav, escapeHtml } from "./nav.js";
import { mountFeedPick, preferredFeedPort } from "./feed-pick.js";
import { fmtLap } from "./fmt.js";

const $ = (id) => document.getElementById(id);
const me = await initNav();
if (!me) throw new Error("auth");
mountFeedPick($("feed-pick"), { preferredPort: preferredFeedPort(me.udpPort ?? null) }).refresh();

let all = [];

function lastLabel(iso) {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function render() {
  const q = $("q").value.trim().toLowerCase();
  const sort = $("sort").value;
  let rows = all.filter((t) => !q || t.name.toLowerCase().includes(q));
  rows.sort((a, b) => {
    if (sort === "az") return a.name.localeCompare(b.name);
    if (sort === "recent") return new Date(b.lastAt) - new Date(a.lastAt);
    if (sort === "best") return (a.bestLapMs || 9e9) - (b.bestLapMs || 9e9);
    return (b.laps || 0) - (a.laps || 0);
  });
  $("list").innerHTML = rows.map((t) => `
    <a class="trk-card" href="/track.html?id=${t.trackId}">
      <h2>${escapeHtml(t.name)}</h2>
      <p><b>${t.laps}</b> laps · <b>${t.sessions}</b> sessions · <b>${t.drivers}</b> drivers</p>
      <p class="trk-best">Best ${fmtLap(t.bestLapMs)}</p>
      <p class="dv-muted">Last ${escapeHtml(lastLabel(t.lastAt))}</p>
    </a>`).join("") || `<p class="dv-muted">No recorded tracks yet. Complete a lap on track to populate this list.</p>`;
}

async function load() {
  all = await (await fetch("/api/tracks")).json();
  render();
}
$("q").addEventListener("input", render);
$("sort").addEventListener("change", render);
$("refresh").onclick = load;
load();
