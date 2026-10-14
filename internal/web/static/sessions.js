// Sessions list: active feeds + closed DB sessions (SetupLab-style cards).
import { initNav, escapeHtml } from "./nav.js";
import { mountFeedPick, preferredFeedPort, savePort } from "./feed-pick.js";
import { fmtLap } from "./fmt.js";

const $ = (id) => document.getElementById(id);
const STAR_KEY = "telelab.starredSessions";
const PAGE = 30;

const me = await initNav();
if (!me) throw new Error("auth");

const picker = mountFeedPick($("feed-pick"), { preferredPort: preferredFeedPort(me.udpPort ?? null) });
picker.refresh();
setInterval(() => picker.refresh(), 5000);

let feeds = [];
let sessions = [];
let closedShown = PAGE;
let fetchedAt = Date.now();

function loadStars() {
  try { return new Set(JSON.parse(localStorage.getItem(STAR_KEY) || "[]")); } catch { return new Set(); }
}
function saveStars(set) {
  try { localStorage.setItem(STAR_KEY, JSON.stringify([...set])); } catch {}
}
let stars = loadStars();

function starKey(row) {
  return row.id != null ? `s:${row.id}` : `p:${row.port}`;
}

function fmtCreated(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}. ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function liveAgeMs(row) {
  if (row.ageMs == null || row.ageMs < 0) return null;
  return row.ageMs + (Date.now() - fetchedAt);
}

function ageLabel(ageMs) {
  if (ageMs == null || ageMs < 0) return null;
  if (ageMs < 3000) return { ok: true, text: "Receiving telemetry" };
  const s = Math.max(1, Math.round(ageMs / 1000));
  const text = s < 60 ? `Last data ${s}s ago` : `Last data ${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s ago`;
  return { ok: false, text };
}

function paintAges() {
  for (const el of document.querySelectorAll("[data-age-port]")) {
    const f = feeds.find((x) => x.port === Number(el.dataset.agePort));
    if (!f) continue;
    const lab = ageLabel(liveAgeMs(f));
    if (!lab) { el.hidden = true; continue; }
    el.hidden = false;
    el.className = `ses-age ${lab.ok ? "ok" : "stale"}`;
    el.textContent = `${lab.ok ? "●" : "⚠"} ${lab.text}`;
  }
}

function openLive(path, port) {
  if (port != null) savePort(port);
  const u = new URL(path, location.origin);
  if (port != null) u.searchParams.set("port", String(port));
  location.href = u.pathname + u.search;
}

function metaLine(row) {
  const bits = [
    row.track || "Unknown track",
    row.type || null,
    row.port != null ? `Port ${row.port}` : null,
    row.playerLaps != null ? `${row.playerLaps} lap${row.playerLaps === 1 ? "" : "s"}` : null,
    row.bestLapMs ? `Best ${fmtLap(row.bestLapMs)}` : null,
  ].filter(Boolean);
  return bits.join(" · ");
}

function card(row, { active }) {
  const key = starKey(row);
  const starred = stars.has(key);
  const who = row.owner || row.player || `Port ${row.port}`;
  const title = `${who}${row.track ? ` ${row.track}` : ""}`;
  const review = row.id != null
    ? `<a class="ses-btn" href="/session.html?id=${row.id}">Review</a>`
    : `<button type="button" class="ses-btn" disabled title="Available after the first completed lap">Review</button>`;

  const liveBtns = active ? `
    <button type="button" class="ses-btn ses-btn-primary" data-go="workbench" data-port="${row.port}">Workbench</button>
    <button type="button" class="ses-btn" data-go="driver" data-port="${row.port}">Driver View</button>
    <button type="button" class="ses-btn" data-go="telem" data-port="${row.port}">Team Telem</button>
    <button type="button" class="ses-btn" data-go="connect" data-port="${row.port}">Connect</button>
    ${review}` : `
    <button type="button" class="ses-btn ses-btn-primary" data-go="workbench" data-port="${row.port}">Workbench</button>
    <button type="button" class="ses-btn" data-go="telem" data-port="${row.port}">Team Telem</button>
    ${review}
    <a class="ses-btn" href="/compare.html">Compare</a>`;

  return `<article class="ses-card" data-key="${escapeHtml(key)}">
    <div class="ses-card-main">
      <h3>${escapeHtml(title)}</h3>
      <p class="ses-meta">${escapeHtml(metaLine(row))}</p>
      ${active ? `<p class="ses-age" data-age-port="${row.port}"></p>` : ""}
      <p class="ses-created">Created: ${escapeHtml(fmtCreated(row.startedAt || row.createdAt))}</p>
    </div>
    <div class="ses-card-side">
      <button type="button" class="ses-star${starred ? " on" : ""}" data-star="${escapeHtml(key)}" aria-label="${starred ? "Unstar" : "Star"}" title="Star">${starred ? "★" : "☆"}</button>
      <span class="ses-badge ${active ? "active" : "closed"}">${active ? "Active" : "Closed"}</span>
      <span class="ses-badge spec">F1 26</span>
      <div class="ses-actions">${liveBtns}</div>
    </div>
  </article>`;
}

function matchesQuery(row, q) {
  if (!q) return true;
  const hay = [row.player, row.owner, row.track, row.type, String(row.port ?? ""), String(row.id ?? "")]
    .join(" ").toLowerCase();
  return hay.includes(q);
}

function buildRows() {
  const q = $("q").value.trim().toLowerCase();
  const starredOnly = $("starred").checked;

  const byPort = new Map();
  for (const s of sessions) {
    const prev = byPort.get(s.port);
    if (!prev || new Date(s.lastPacketAt) > new Date(prev.lastPacketAt)) byPort.set(s.port, s);
  }

  const activePorts = new Set(feeds.filter((f) => f.active).map((f) => f.port));
  const active = feeds.filter((f) => f.active).map((f) => {
    const db = byPort.get(f.port);
    return {
      id: db?.id,
      port: f.port,
      player: f.player || db?.player,
      owner: f.owner,
      track: f.track || db?.track,
      type: f.type || db?.type,
      ageMs: f.ageMs,
      startedAt: db?.startedAt,
      playerLaps: db?.playerLaps,
      bestLapMs: db?.bestLapMs,
      active: true,
    };
  }).filter((r) => matchesQuery(r, q) && (!starredOnly || stars.has(starKey(r))));

  // Hide the latest DB row for an active port — it is shown under Active.
  const closed = sessions
    .filter((s) => {
      if (!activePorts.has(s.port)) return true;
      const latest = byPort.get(s.port);
      return !latest || latest.id !== s.id;
    })
    .filter((s) => matchesQuery(s, q) && (!starredOnly || stars.has(starKey(s))));

  return { active, closed };
}

function render() {
  const { active, closed } = buildRows();
  const total = sessions.length;
  const oldest = sessions.at(-1)?.startedAt;
  const newest = sessions[0]?.startedAt;
  const range = oldest && newest
    ? `${fmtCreated(oldest).slice(0, 14)} – ${fmtCreated(newest).slice(0, 14)}`
    : "";

  $("summary").textContent = `${total} sessions (${active.length} active shown, ${closed.length} closed match) · ${range}`.replace(/ · $/, "");

  $("block-active").hidden = active.length === 0;
  $("active-title").textContent = `Active sessions (${active.length})`;
  $("active").innerHTML = active.map((r) => card(r, { active: true })).join("");

  $("closed-title").textContent = `Closed sessions (${closed.length})`;
  const slice = closed.slice(0, closedShown);
  $("closed").innerHTML = slice.map((r) => card(r, { active: false })).join("")
    || `<p class="dv-muted">No closed sessions${ $("q").value || $("starred").checked ? " match this filter" : " yet. Complete a lap on track to record one" }.</p>`;

  const remain = closed.length - slice.length;
  $("more").hidden = remain <= 0;
  $("more").textContent = `Show more (${remain} remaining)`;
  paintAges();
}

async function load({ resetPage = false } = {}) {
  if (resetPage) $("summary").textContent = "Loading…";
  const [fRes, sRes] = await Promise.all([
    fetch("/api/feeds"),
    fetch("/api/sessions?limit=500&all=1"),
  ]);
  feeds = fRes.ok ? await fRes.json() : [];
  sessions = sRes.ok ? await sRes.json() : [];
  fetchedAt = Date.now();
  if (resetPage) closedShown = PAGE;
  render();
}

$("q").addEventListener("input", () => { closedShown = PAGE; render(); });
$("starred").addEventListener("change", () => { closedShown = PAGE; render(); });
$("refresh").onclick = () => load({ resetPage: true });
$("more").onclick = () => { closedShown += PAGE; render(); };

document.querySelector("main.ses").addEventListener("click", (e) => {
  const star = e.target.closest("[data-star]");
  if (star) {
    const k = star.dataset.star;
    if (stars.has(k)) stars.delete(k); else stars.add(k);
    saveStars(stars);
    render();
    return;
  }
  const go = e.target.closest("[data-go]");
  if (!go) return;
  const port = Number(go.dataset.port);
  if (go.dataset.go === "connect") {
    picker.setPort(port);
    return;
  }
  const map = { workbench: "/workbench.html", driver: "/", telem: "/team-telem.html", weather: "/weather.html" };
  openLive(map[go.dataset.go] || "/", port);
});

load({ resetPage: true });
setInterval(() => load(), 15000);
setInterval(paintAges, 1000);
