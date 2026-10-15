// TeleLab Driver View. Connects to /api/feeds/{port}/live and renders each snapshot (10 Hz).
import { initNav, escapeHtml } from "./nav.js";
import { mountFeedPick, preferredFeedPort } from "./feed-pick.js";

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
let focusIdx = -1;
let msgCount = 0;
let hz = 0;
let picker = null;

initNav().then((me) => {
  if (!me) return;
  publicIp = me.publicIp || null;
  myPort = me.udpPort ?? null;
  $("empty-ip").textContent = publicIp || location.hostname;
  picker = mountFeedPick($("feed-pick"), {
    preferredPort: preferredFeedPort(myPort),
    onChange: (port) => connect(port),
  });
  picker.refresh();
  setInterval(() => picker?.refresh(), 5000);
});

const shortName = (n) => {
  const parts = String(n || "").trim().split(/\s+/);
  return (parts.at(-1) || "?").toUpperCase().slice(0, 12);
};

function connect(port) {
  if (port == null) return;
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
  const own = focus.idx === p.idx;

  const lapLabel = ses.totalLaps > 1 ? `lap ${p.lap} of ${ses.totalLaps}` : `lap ${p.lap}`;
  const left = ses.timeLeft != null ? `${Math.floor(ses.timeLeft / 60)}:${String(ses.timeLeft % 60).padStart(2, "0")} left` : "";
  $("session").textContent = [ses.track, ses.type].filter(Boolean).join(" · ");
  $("dv-title").textContent = ses.track || "–";
  $("meta").textContent = [ses.type, lapLabel, left].filter(Boolean).join(" · ");
  $("live-label").textContent = stale ? "Stale" : "Live";
  $("live-badge").dataset.state = stale ? "stale" : "live";

  $("focus-pos").textContent = focus.position ? `P${focus.position}` : "–";
  $("focus-name").textContent = focus.name || "–";
  const src = own ? p : focus;
  const pen = src.penaltiesSec ?? 0, warn = src.warnings ?? 0;
  $("focus-sub").textContent = [focus.team || p.team, `${pen} s penalty`, `${warn} warning${warn === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
  $("focus-note").hidden = own;

  renderDrivers(cars, focus.idx, p.idx);
  renderLap(p, focus, own);
  renderGaps(cars, focus, p, own);
  renderTyres(p);
  renderEnergy(p);
  renderFuel(p);
  renderWeather(ses, s.forecast || []);
  renderDamage(p);
  renderTyreOpts(s.tyreOpts || []);
  renderPit(ses, p);
}

function renderDrivers(cars, focus, playerIdx) {
  const sorted = [...cars].sort((a, b) => (a.position || 99) - (b.position || 99));
  $("drivers").innerHTML = sorted.map((c) => {
    const cls = [c.idx === focus ? "on" : "", c.idx === playerIdx ? "me" : ""].filter(Boolean).join(" ");
    return `<button type="button" class="dv-chip ${cls}" data-idx="${c.idx}" role="option" aria-selected="${c.idx === focus}">
      <span class="p">P${c.position || "–"}</span>${escapeHtml(shortName(c.name))}</button>`;
  }).join("");
  $("drivers").onclick = (e) => {
    const btn = e.target.closest("button[data-idx]");
    if (!btn) return;
    focusIdx = Number(btn.dataset.idx);
  };
}

const fmtLap = (ms) => {
  if (!ms) return "–";
  const m = Math.floor(ms / 60000);
  const sec = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return `${m}:${sec}`;
};
const fmtSec = (ms) => (ms ? (ms / 1000).toFixed(3) : "–");

function renderLap(p, focus, own) {
  const src = own ? p : focus;
  $("lap-ref").textContent = `Last ${fmtLap(src.lastLapMs)} · Best ${fmtLap(src.bestLapMs)}`;
  if (!own) {
    $("lap-time").textContent = fmtLap(focus.lastLapMs);
    $("lap-time").classList.remove("invalid");
    $("sectors").innerHTML = [["S1", focus.s1Ms], ["S2", focus.s2Ms]].map(([n, v]) =>
      `<div class="sec"><span>${n} last lap</span><b>${fmtSec(v)}</b></div>`).join("");
    return;
  }
  $("lap-time").textContent = fmtLap(p.curLapMs);
  $("lap-time").classList.toggle("invalid", !!p.invalid);
  const s3 = p.sector === 2 && p.curLapMs ? p.curLapMs - p.s1Ms - p.s2Ms : 0;
  const run = (i) => i === p.sector;
  const cells = [
    ["S1", p.sector > 0 ? p.s1Ms : (run(0) ? p.curLapMs : 0), run(0)],
    ["S2", p.sector > 1 ? p.s2Ms : (run(1) ? p.curLapMs - p.s1Ms : 0), run(1)],
    ["S3", run(2) ? s3 : 0, run(2)],
  ];
  $("sectors").innerHTML = cells.map(([n, v, live]) =>
    `<div class="sec ${live ? "run" : ""}"><span>${n}${live ? " · running" : ""}</span><b>${v ? fmtSec(v) : "–"}</b></div>`).join("")
    + (p.invalid ? `<p class="lap-invalid">Lap invalidated</p>` : "");
}

function renderGaps(cars, focus, p, own) {
  const sorted = [...cars].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((c) => c.idx === focus.idx);
  const ahead = i > 0 ? sorted[i - 1] : null;
  const behind = i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null;
  const gapAhead = own ? p.gapAheadMs : focus.intervalMs;
  const line = (who, c, gap, sign) => c
    ? `<div class="gap"><div><b class="gap-who">${escapeHtml(shortName(c.name))} ${who}</b>
        <span class="gap-meta">${escapeHtml(c.compound || "–")} ${c.tyreAge ?? 0}L · ERS ${Math.round(c.ersPct ?? 0)}% · wear ${Number(c.maxWear ?? 0).toFixed(0)}%</span></div>
        <b class="gap-val">${gap ? `${sign}${(gap / 1000).toFixed(3)}` : "–"}</b></div>`
    : `<div class="gap"><b class="gap-who">${who === "ahead" ? "Leading" : "Last"}</b><b class="gap-val">–</b></div>`;
  $("gaps").innerHTML = line("ahead", ahead, gapAhead, "+") + line("behind", behind, behind?.intervalMs, "−");
}

function tempClass(t) {
  if (t < 70) return "cold";
  if (t > 105) return "hot";
  return "ok";
}

function renderTyres(p) {
  const c = p.compound || "–";
  $("tyre-head").textContent = `Tyres · ${c}${p.actual ? ` ${p.actual}` : ""}`;
  $("tyre-age").textContent = p.tyreAge ? `${p.tyreAge} laps old` : "new set";
  $("tyres").innerHTML = WHEELS.map(({ i, label }) => {
    const w = p.tyreWear?.[i] ?? 0;
    const inner = p.tyreInner?.[i] ?? 0;
    const left = Math.max(0, 100 - w);
    const cls = w >= 60 ? "bad" : w >= 30 ? "warn" : "";
    return `<div class="ring-wrap"><div class="ring ${cls}" style="--v:${left}%"><b class="${tempClass(inner)}">${inner}°</b></div>
      <span>${label} · ${w.toFixed(0)}% worn</span></div>`;
  }).join("");
}

function renderEnergy(p) {
  const pct = Math.round(p.ersPct ?? 0);
  const ot = p.overtakeActive ? "Overtake active" : p.overtakeAvailable ? "Overtake available" : "Overtake not available";
  const t = p.engineTemp;
  const eng = t >= 130 ? "bad" : t >= 110 ? "warn" : "";
  $("energy").innerHTML = `<div class="ring big energy" style="--v:${Math.min(100, pct)}%"><b>${pct}%</b></div>
    <div class="energy-txt">
      <span class="t-lab cat">Energy · ${escapeHtml(p.ersMode || "–")}</span>
      <span>Deployed <b>${Number(p.ersDeployedMJ ?? 0).toFixed(1)} MJ</b></span>
      <span>Harvested <b>${Number(p.ersHarvestedMJ ?? 0).toFixed(1)} MJ</b> of ${Number(p.ersHarvestLimitMJ ?? 0).toFixed(1)}</span>
      <span class="muted">${ot}</span>
      <span class="muted">Engine <b class="${eng}">${t}°C</b> · ICE ${Math.round(p.powerIceKW || 0)} kW · MGU-K ${Math.round(p.powerMgukKW || 0)} kW</span>
    </div>`;
}

function renderFuel(p) {
  const fl = p.fuelLaps ?? 0;
  $("fuel").innerHTML = `<b class="big-num ${fl < 0 ? "bad" : ""}">${fl >= 0 ? "+" : "−"}${Math.abs(fl).toFixed(1)}</b>
    <span class="muted">laps ${fl < 0 ? "short" : "spare"} · ${Number(p.fuel ?? 0).toFixed(1)} kg in the tank</span>`;
}

function renderWeather(ses, forecast) {
  const now = forecast[0];
  const rain = now?.rain ?? ses.rainPct ?? 0;
  $("wx-head").textContent = `Weather · ${(WEATHER[ses.weather] || "–").toLowerCase()}`;
  $("wx-temps").textContent = `track ${ses.trackTemp}° · air ${ses.airTemp}° · rain ${rain}%`;
  if (!forecast.length) { $("weather").innerHTML = `<p class="muted">No forecast samples yet.</p>`; return; }
  $("weather").innerHTML = forecast.slice(0, 8).map((f) =>
    `<div class="rb ${f.rain >= 60 ? "wet" : ""}"><span class="rb-pct">${f.rain}%</span><i style="height:${Math.max(6, f.rain)}%"></i><span class="rb-t">${f.offset ? `+${f.offset}` : "now"}</span></div>`).join("");
}

function renderDamage(p) {
  const dm = p.damage || {};
  const hit = DAMAGE.map(([k, n]) => [n, dm[k] ?? 0]).filter(([, v]) => v > 0);
  $("damage").innerHTML = hit.length
    ? hit.map(([n, v]) => `<span class="chip ${v >= 30 ? "bad" : "warn"}">${n} ${v}%</span>`).join("")
      + (hit.length < DAMAGE.length ? `<span class="chip">Rest of the car OK</span>` : "")
    : `<span class="chip">No damage</span>`;
}

function renderTyreOpts(opts) {
  if (!opts.length) {
    $("tyreopts").innerHTML = `<p class="muted">The game only sends this for your own car.</p>`;
    return;
  }
  $("tyreopts").innerHTML = `<ul class="topts">${opts.map((o) => {
    const delta = o.fastest ? "fastest" : `${o.deltaMs >= 0 ? "+" : "−"}${(Math.abs(o.deltaMs) / 1000).toFixed(2)} s`;
    return `<li class="${o.fastest ? "fast" : ""}"><i style="--c:${COMPOUND[o.visual] || "var(--line)"}"></i>
      <span>${escapeHtml(o.visual)} ${escapeHtml(o.actual && o.actual !== o.visual ? o.actual : "")}</span><b>${delta}</b></li>`;
  }).join("")}</ul>`;
}

function renderPit(ses, p) {
  const total = ses.totalLaps || 0;
  if (total <= 1) {
    $("pit-note").textContent = "No race distance in this session";
    $("pit").innerHTML = "";
    return;
  }
  const lo = ses.pitIdealLap || 0, hi = ses.pitLatestLap || 0;
  $("pit-note").textContent = lo
    ? `Pit window laps ${lo}–${hi || lo}${ses.pitRejoinPos ? ` · rejoin P${ses.pitRejoinPos}` : ""}`
    : `Lap ${p.lap} of ${total}`;
  $("pit").style.setProperty("--n", total);
  $("pit").innerHTML = Array.from({ length: total }, (_, k) => {
    const n = k + 1;
    const cls = n < p.lap ? "done" : n === p.lap ? "now" : (lo && n >= lo && n <= (hi || lo)) ? "win" : "";
    return `<i class="${cls}" title="Lap ${n}"></i>`;
  }).join("") + `<p class="lap-legend"><span><i class="done"></i>Done</span><span><i class="now"></i>Lap ${p.lap}</span>${lo ? `<span><i class="win"></i>Pit window</span>` : ""}<span class="muted">${Math.max(0, total - p.lap)} laps to go</span></p>`;
}
