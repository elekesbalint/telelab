// TeleLab Driver View. Connects to /api/feeds/{port}/live and renders each snapshot (10 Hz).
import { initNav, escapeHtml } from "./nav.js";
const $ = (id) => document.getElementById(id);
const COMPOUND = { Soft: "var(--soft)", Medium: "var(--medium)", Hard: "var(--hard)", Inter: "var(--inter)", Wet: "var(--wet)" };
const WEATHER = ["Clear", "Light cloud", "Overcast", "Light rain", "Heavy rain", "Storm"];
const WHEELS = [
  { i: 2, label: "FL" }, { i: 3, label: "FR" },
  { i: 0, label: "RL" }, { i: 1, label: "RR" },
];
const DAMAGE = [
  ["frontLeftWing", "FL wing"], ["frontRightWing", "FR wing"], ["rearWing", "Rear wing"],
  ["floor", "Floor"], ["diffuser", "Diffuser"], ["sidepod", "Sidepod"],
];
let ws = null;
let currentPort = null;
let lastUid = null;
let publicIp = null;
let myPort = null;
let focusIdx = -1; // -1 until first snapshot; then car idx
let msgCount = 0;
let hz = 0;

initNav().then((me) => {
  if (!me) return;
  publicIp = me.publicIp || null;
  myPort = me.udpPort ?? null;
  $("empty-ip").textContent = publicIp || location.hostname;
  loadFeeds();
});

const fmtGap = (ms) => (ms ? `+${(ms / 1000).toFixed(3)}` : "–");
const shortName = (n) => {
  const parts = String(n || "").trim().split(/\s+/);
  return (parts.at(-1) || "?").toUpperCase().slice(0, 12);
};

async function loadFeeds() {
  let feeds = [];
  try { feeds = await (await fetch("/api/feeds")).json(); } catch { return; }
  const sel = $("feed");
  let saved = null;
  try { saved = Number(localStorage.getItem("telelab.port")) || null; } catch {}
  const prev = currentPort ?? saved ?? myPort;
  sel.innerHTML = "";
  for (const f of feeds) {
    const o = document.createElement("option");
    o.value = f.port;
    const who = f.owner || f.player || "unknown";
    o.textContent = f.active ? `${who}, ${f.track || "?"} (live)` : `${f.owner || "free port"} (${f.port})`;
    sel.append(o);
  }
  const active = feeds.find((f) => f.active);
  const pick = feeds.some((f) => f.port === prev) && prev != null ? prev : active ? active.port : feeds[0]?.port;
  if (pick != null) {
    sel.value = pick;
    if (pick !== currentPort) connect(pick);
  }
}

$("feed").addEventListener("change", (e) => {
  const port = Number(e.target.value);
  try { localStorage.setItem("telelab.port", port); } catch {}
  connect(port);
});

function connect(port) {
  currentPort = port;
  focusIdx = -1;
  if (ws) ws.close();
  setConn("off", "Connecting…");
  $("empty-port").textContent = port;
  $("empty-ip").textContent = publicIp || location.hostname;
  showEmpty(true);
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/api/feeds/${port}/live`);
  ws.onmessage = (ev) => {
    msgCount++;
    render(JSON.parse(ev.data));
  };
  ws.onclose = () => {
    if (currentPort !== port) return;
    setConn("off", "Connection lost, retrying…");
    setTimeout(() => currentPort === port && connect(port), 3000);
  };
}

function setConn(state, text) {
  const el = $("conn");
  el.dataset.state = state;
  el.textContent = text;
}
function showEmpty(empty) {
  $("empty").hidden = !empty;
  $("live").hidden = empty;
}

setInterval(() => {
  hz = msgCount;
  msgCount = 0;
  if ($("hz") && !$("live").hidden) $("hz").textContent = `${hz} Hz`;
}, 1000);

function render(s) {
  if (s.sessionUid !== lastUid) { lastUid = s.sessionUid; focusIdx = -1; }
  const stale = s.ageMs > 3000;
  setConn(stale ? "stale" : "live", stale ? `Last data ${Math.round(s.ageMs / 1000)} s ago` : "Live");
  const p = s.player;
  showEmpty(!s.session || !p);
  if (!s.session || !p) return;

  const ses = s.session;
  const cars = s.cars || [];
  if (focusIdx < 0) focusIdx = p.idx;
  if (!cars.some((c) => c.idx === focusIdx)) focusIdx = p.idx;
  const focus = cars.find((c) => c.idx === focusIdx) || { idx: p.idx, name: p.name, position: p.position, isPlayer: true };

  const weatherName = WEATHER[ses.weather] || "–";
  const lapLabel = ses.totalLaps > 1 ? `Lap ${p.lap}/${ses.totalLaps}` : `Lap ${p.lap}`;
  const left = ses.timeLeft != null ? `${Math.floor(ses.timeLeft / 60)}:${String(ses.timeLeft % 60).padStart(2, "0")}` : "";
  $("session").textContent = [ses.track, ses.type, lapLabel].filter(Boolean).join(" · ");
  $("meta").textContent = [ses.track, ses.type, lapLabel, left, `${weatherName} ${ses.airTemp}° air ${ses.trackTemp}° track`].filter(Boolean).join(" · ");
  $("live-label").textContent = stale ? "STALE" : `LIVE · ${focus.name || "–"}`;
  $("live-badge").dataset.state = stale ? "stale" : "live";

  $("focus-name").textContent = focus.name || "–";
  $("focus-pos").textContent = focus.position ? `P${focus.position}` : "–";
  $("focus-note").hidden = focus.idx === p.idx;

  renderDrivers(cars, focus.idx, p.idx);
  renderWeather(ses, s.forecast || []);
  renderTyreOpts(s.tyreOpts || []);
  renderRelative(cars, focus);
  renderDamage(p);
  renderFuel(p);
  renderCompound(p);
  renderGap(p, focus);
  renderEngine(p);
  renderTemps(p);
  renderWear(p);
  renderPenalties(focus.isPlayer ? p : focus);
}

function renderDrivers(cars, focus, playerIdx) {
  $("drivers").innerHTML = cars.map((c) => {
    const cls = [
      c.idx === focus ? "on" : "",
      c.idx === playerIdx ? "me" : "",
    ].filter(Boolean).join(" ");
    return `<button type="button" class="dv-chip ${cls}" data-idx="${c.idx}" role="option" aria-selected="${c.idx === focus}">
      <span class="p">P${c.position || "–"}</span>${escapeHtml(shortName(c.name))}</button>`;
  }).join("");
  $("drivers").onclick = (e) => {
    const btn = e.target.closest("button[data-idx]");
    if (!btn) return;
    focusIdx = Number(btn.dataset.idx);
  };
}

function weatherIcon(w) {
  const sun = `<circle cx="12" cy="12" r="5" fill="var(--medium)"/>`;
  const cloud = (fill) => `<path d="M7 18h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.4A3.3 3.3 0 0 0 7 18z" fill="${fill}"/>`;
  const drops = (n) => Array.from({ length: n }, (_, i) => `<line x1="${8 + i * 4}" y1="20" x2="${7 + i * 4}" y2="23" stroke="var(--wet)" stroke-width="1.6" stroke-linecap="round"/>`).join("");
  const body = [sun, sun + cloud("var(--dim)"), cloud("var(--dim)"), cloud("var(--dim)") + drops(2),
    cloud("var(--line)") + drops(3), cloud("var(--line)") + drops(3)][w] || sun;
  return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${body}</svg>`;
}

function renderWeather(ses, forecast) {
  const now = forecast[0];
  const rain = now?.rain ?? ses.rainPct ?? 0;
  const head = `<div class="dv-wx-now">
    <div>${weatherIcon(ses.weather)}<b>${escapeHtml(WEATHER[ses.weather] || "–")}</b></div>
    <div class="dv-wx-temps"><span>Track ${ses.trackTemp}°C</span><span>Air ${ses.airTemp}°C</span><span>Rain ${rain}%</span></div>
  </div>`;
  const row = forecast.length
    ? `<div class="dv-wx-row">${forecast.slice(0, 7).map((f) =>
      `<div class="dv-wx"><span>+${f.offset}m</span>${weatherIcon(f.weather)}<b>${f.rain}%</b></div>`).join("")}</div>`
    : `<p class="dv-muted">No forecast samples yet.</p>`;
  $("weather").innerHTML = head + row;
}

function renderTyreOpts(opts) {
  if (!opts.length) {
    $("tyreopts").innerHTML = `<p class="dv-muted">Tyre set data is only sent for your own car.</p>`;
    return;
  }
  const label = { dry: "Dry", inter: "Inter", wet: "Wet" };
  $("tyreopts").innerHTML = opts.map((o) => {
    const delta = o.fastest ? "fastest" : `${o.deltaMs >= 0 ? "+" : "−"}${(Math.abs(o.deltaMs) / 1000).toFixed(1)}s`;
    return `<div class="dv-topt ${o.fastest ? "fast" : ""}" style="--c:${COMPOUND[o.visual] || "var(--line)"}">
      <span class="kind">${label[o.kind] || o.kind}</span>
      <b>${escapeHtml(o.actual || o.visual)}</b>
      <em>${delta}</em>
    </div>`;
  }).join("");
}

function renderRelative(cars, focus) {
  const sorted = [...cars].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((c) => c.idx === focus.idx);
  const ahead = i > 0 ? sorted[i - 1] : null;
  const behind = i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null;
  const block = (title, c) => {
    if (!c) return `<div class="dv-rel-col"><span class="lab">${title}</span><b class="empty">–</b></div>`;
    return `<div class="dv-rel-col">
      <span class="lab">${title}</span>
      <b>P${c.position} ${escapeHtml(shortName(c.name))}</b>
      <div class="dv-rel-meta">
        <span>ERS <em>${Math.round(c.ersPct ?? 0)}%</em></span>
        <i class="dv-ers"><b style="width:${Math.min(100, c.ersPct || 0)}%"></b></i>
        <span>${escapeHtml(c.compound || "–")} ${c.tyreAge ?? 0}L</span>
        <span>Wear ${Number(c.maxWear ?? 0).toFixed(0)}%</span>
      </div>
    </div>`;
  };
  $("relative").innerHTML = block("Ahead", ahead) + block("Behind", behind);
}

function renderDamage(p) {
  const dm = p.damage || {};
  $("damage").innerHTML = DAMAGE.map(([k, n]) => {
    const v = dm[k] ?? 0;
    const cls = v >= 30 ? "bad" : v > 0 ? "warn" : "ok";
    return `<div class="${cls}"><span>${n}</span><b>${v > 0 ? v + "%" : "OK"}</b></div>`;
  }).join("");
}

function renderFuel(p) {
  const fl = p.fuelLaps;
  const color = fl < 0 ? "bad" : "good";
  $("fuel").innerHTML = `
    <div><dt>Fuel in laps</dt><dd class="${color}">${fl.toFixed(2)}</dd></div>
    <div><dt>Burn / lap</dt><dd>–</dd></div>
    <div><dt>Burn last lap</dt><dd>–</dd></div>
    <div><dt>At finish</dt><dd class="${color}">${fl.toFixed(2)}</dd></div>`;
}

function renderCompound(p) {
  const c = p.compound || "–";
  $("tyres-compound").innerHTML = `
    <span class="dv-comp" style="--c:${COMPOUND[c] || "var(--line)"}">${escapeHtml(c)}</span>
    <p class="dv-muted">Age: ${p.tyreAge ? `${p.tyreAge} laps` : "new"} · ${escapeHtml(p.actual || "")}</p>`;
}

function renderGap(p, focus) {
  // Gaps come from the player's LapData; when focusing another car use their interval / leader gap.
  const gapAhead = focus.isPlayer ? p.gapAheadMs : focus.intervalMs;
  const gapLeader = focus.isPlayer ? p.gapLeaderMs : focus.gapLeaderMs;
  const pos = focus.position || p.position;
  $("gap").innerHTML = `
    <b class="dv-big">${pos === 1 ? "Leader" : fmtGap(gapAhead)}</b>
    <p class="dv-muted">Leader: ${pos === 1 ? "–" : fmtGap(gapLeader)}</p>`;
}

function renderEngine(p) {
  const t = p.engineTemp;
  const cls = t >= 130 ? "bad" : t >= 110 ? "warn" : "good";
  $("engine").innerHTML = `
    <b class="dv-big ${cls}">${t}°C</b>
    <p class="dv-muted">ICE: ${Math.round(p.powerIceKW || 0)} kW · MGU-K: ${Math.round(p.powerMgukKW || 0)} kW</p>`;
}

function tempClass(t) {
  if (t < 70) return "cold";
  if (t > 105) return "hot";
  return "ok";
}

function renderTemps(p) {
  $("temps").innerHTML = WHEELS.map(({ i, label }) => {
    const inner = p.tyreInner?.[i] ?? 0;
    const surf = p.tyreSurface?.[i] ?? 0;
    return `<div class="dv-temp ${tempClass(inner)}">
      <span>${label}</span><b>${inner}°C</b><small>Surface ${surf}°C</small></div>`;
  }).join("");
}

function wearClass(w) {
  if (w >= 60) return "bad";
  if (w >= 30) return "warn";
  return "ok";
}

function renderWear(p) {
  $("wear").innerHTML = WHEELS.map(({ i, label }) => {
    const w = p.tyreWear?.[i] ?? 0;
    const left = Math.max(0, 100 - w);
    return `<div class="dv-wearbar ${wearClass(w)}">
      <span>${label}</span><i><b style="width:${left}%"></b></i><em>${w.toFixed(0)}%</em></div>`;
  }).join("");
}

function renderPenalties(src) {
  const sec = src.penaltiesSec ?? 0;
  const warn = src.warnings ?? 0;
  if (!sec && !warn) {
    $("penalties").textContent = "No penalties";
    $("penalties").className = "dv-muted";
    return;
  }
  $("penalties").className = "warn";
  $("penalties").textContent = `${sec} s time penalty · ${warn} warning${warn === 1 ? "" : "s"}`;
}

setInterval(loadFeeds, 5000);
