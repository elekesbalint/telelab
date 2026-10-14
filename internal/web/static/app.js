// TeleLab live driver view. Connects to /api/feeds/{port}/live and renders
// each snapshot (sent 10x per second).

const $ = (id) => document.getElementById(id);
const COMPOUND = { Soft: "var(--soft)", Medium: "var(--medium)", Hard: "var(--hard)", Inter: "var(--inter)", Wet: "var(--wet)" };
const COMPOUND_HU = { Soft: "Soft", Medium: "Medium", Hard: "Hard", Inter: "Intermediate", Wet: "Esőgumi" };
const ERS_HU = { None: "nincs", Medium: "medium", Hotlap: "hotlap", Boost: "boost" };
const DAMAGE_HU = { frontLeftWing: "Bal első szárny", frontRightWing: "Jobb első szárny", rearWing: "Hátsó szárny", floor: "Padló", diffuser: "Diffúzor", sidepod: "Oldaldoboz", gearbox: "Váltó", engine: "Motor" };
const ERS_MAX_MJ = 4;
const TRACE_SECONDS = 20;

let ws = null;
let currentPort = null;
let trace = [];
let sectorBests = {}; // carIdx -> {s1, s2}
let lastUid = null;
let publicIp = null;
fetch("/api/config").then((r) => r.json()).then((c) => { publicIp = c.publicIp || null; $("empty-ip").textContent = publicIp || location.hostname; }).catch(() => {});

const fmtLap = (ms) => {
  if (!ms) return "–";
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3);
  return m ? `${m}:${s.padStart(6, "0")}` : s;
};
const fmtGap = (ms) => (ms ? `+${(ms / 1000).toFixed(3)}` : "–");

// ---------- feeds ----------
async function loadFeeds() {
  let feeds = [];
  try {
    feeds = await (await fetch("/api/feeds")).json();
  } catch { return; }
  const sel = $("feed");
  const saved = Number(localStorage.getItem("telelab.port")) || null;
  const prev = currentPort ?? saved;
  sel.innerHTML = "";
  for (const f of feeds) {
    const o = document.createElement("option");
    o.value = f.port;
    const who = f.player || "nincs adat";
    o.textContent = f.active ? `${who}, ${f.track || "?"} (port ${f.port})` : `Port ${f.port}${f.player ? `, utoljára ${f.player}` : ""}`;
    sel.append(o);
  }
  const active = feeds.find((f) => f.active);
  const pick = feeds.some((f) => f.port === prev) && (prev !== null) ? prev : active ? active.port : feeds[0]?.port;
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
  trace = [];
  sectorBests = {};
  if (ws) ws.close();
  setConn("off", "Kapcsolódás…");
  $("empty-port").textContent = port;
  $("empty-ip").textContent = publicIp || location.hostname;
  showEmpty(true);
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/api/feeds/${port}/live`);
  ws.onmessage = (ev) => render(JSON.parse(ev.data));
  ws.onclose = () => {
    if (currentPort !== port) return;
    setConn("off", "Kapcsolat megszakadt, újrapróbálom…");
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

// ---------- render ----------
function render(s) {
  if (s.sessionUid !== lastUid) { lastUid = s.sessionUid; trace = []; sectorBests = {}; }
  const stale = s.ageMs > 3000;
  setConn(stale ? "stale" : "live", stale ? `Utolsó adat ${Math.round(s.ageMs / 1000)} mp-e` : "Élő");
  const p = s.player;
  showEmpty(!s.session || !p);
  if (!s.session || !p) return;

  const ses = s.session;
  const parts = [ses.track, ses.type, ses.totalLaps > 1 ? `${ses.totalLaps} kör` : null,
    `pálya ${ses.trackTemp} °C, levegő ${ses.airTemp} °C`, ses.rainPct ? `eső ${ses.rainPct}%` : null];
  $("session").textContent = parts.filter(Boolean).join(", ");

  // driving
  $("speed").textContent = p.speed;
  $("gear").textContent = p.gear < 0 ? "R" : p.gear === 0 ? "N" : p.gear;
  const rpmPct = p.maxRpm ? Math.min(100, (p.rpm / p.maxRpm) * 100) : 0;
  const rpmBar = $("rpm-bar");
  rpmBar.style.width = `${rpmPct}%`;
  rpmBar.classList.toggle("redline", rpmPct > 96);
  $("rpm").textContent = p.rpm.toLocaleString("hu-HU");
  $("engine").textContent = `${p.engineTemp} °C`;
  $("bias").textContent = p.brakeBias ? `${p.brakeBias}%` : "–";
  $("thr-bar").style.width = `${p.throttle * 100}%`;
  $("brk-bar").style.width = `${p.brake * 100}%`;

  // timing
  $("pos").textContent = p.position || "–";
  $("lap").textContent = ses.totalLaps > 1 ? `Kör ${p.lap} / ${ses.totalLaps}` : `Kör ${p.lap}`;
  $("cur").textContent = fmtLap(p.curLapMs);
  $("invalid").hidden = !p.invalid;
  $("s1").textContent = fmtLap(p.s1Ms);
  $("s2").textContent = fmtLap(p.s2Ms);
  $("sector").textContent = `${p.sector + 1}. szektor`;
  trackSectors(s.cars);
  colorSector($("s1").parentElement, p.idx, "s1", p.s1Ms);
  colorSector($("s2").parentElement, p.idx, "s2", p.s2Ms);
  $("last").textContent = fmtLap(p.lastLapMs);
  $("best").textContent = fmtLap(p.bestLapMs);
  $("gap").textContent = p.position > 1 ? fmtGap(p.gapAheadMs) : "–";
  $("leader").textContent = p.position > 1 ? fmtGap(p.gapLeaderMs) : "–";
  $("pen").textContent = `${p.penaltiesSec} mp, ${p.warnings} db`;

  // tyres: arrays are RL, RR, FL, FR
  const comp = $("compound");
  comp.textContent = COMPOUND_HU[p.compound] || p.compound || "–";
  comp.style.setProperty("--c", COMPOUND[p.compound] || "var(--line)");
  $("tyre-age").textContent = p.tyreAge ? `${p.tyreAge} kör` : "új";
  for (let i = 0; i < 4; i++) {
    const el = $(`t${i}`);
    const surf = p.tyreSurface[i], inner = p.tyreInner[i];
    el.style.setProperty("--t", surf < 80 ? "var(--cold)" : surf > 105 ? "var(--hot)" : "var(--thr)");
    el.innerHTML = `<span class="where">${["Bal hátsó", "Jobb hátsó", "Bal első", "Jobb első"][i]}</span><div class="temp">${surf}<small> / ${inner}</small></div>
      <div class="meta"><span class="wear">${(p.tyreWear?.[i] ?? 0).toFixed(1)}%</span><span>${p.brakeTemp[i]} °C</span></div>`;
  }

  // energy
  $("ers").textContent = `${p.ersStoreMJ.toFixed(2)} MJ`;
  $("ers-mode").textContent = ERS_HU[p.ersMode] || p.ersMode;
  $("ers-bar").style.width = `${Math.min(100, (p.ersStoreMJ / ERS_MAX_MJ) * 100)}%`;
  $("ers-lap").textContent = `Ebben a körben: ${p.ersDeployedMJ.toFixed(2)} MJ leadva, ${p.ersHarvestedMJ.toFixed(2)} MJ visszanyerve`;
  $("fuel").textContent = `${p.fuel.toFixed(2)} kg`;
  const fl = p.fuelLaps;
  $("fuel-laps").textContent = `${fl >= 0 ? "+" : ""}${fl.toFixed(2)} kör`;
  $("fuel-laps").style.color = fl < 0 ? "var(--brk)" : "";
  $("fuel-mix").textContent = `Keverék: ${["lean", "standard", "rich", "max"][p.fuelMix] ?? "–"}`;
  $("f-aero").className = p.aeroStraight ? "on" : p.aeroAvailable ? "ready" : "";
  $("f-aero").textContent = p.aeroStraight ? "Aero: egyenes mód" : "Aero: kanyar mód";
  $("f-ot").className = p.overtakeActive ? "on" : p.overtakeAvailable ? "ready" : "";
  $("f-drs").className = p.drs ? "on" : "";
  const dmg = Object.entries(p.damage || {}).filter(([, v]) => v > 0);
  $("damage").innerHTML = dmg.length
    ? dmg.map(([k, v]) => `<div><dt>${DAMAGE_HU[k] || k}</dt><dd>${v}%</dd></div>`).join("")
    : `<div><dt>Sérülés</dt><dd>nincs</dd></div>`;

  renderCars(s.cars);
  renderEvents(s.events);
  pushTrace(p);
}

function trackSectors(cars) {
  for (const c of cars) {
    const b = (sectorBests[c.idx] ??= { s1: 0, s2: 0 });
    if (c.s1Ms && (!b.s1 || c.s1Ms < b.s1)) b.s1 = c.s1Ms;
    if (c.s2Ms && (!b.s2 || c.s2Ms < b.s2)) b.s2 = c.s2Ms;
  }
}
function colorSector(el, idx, key, ms) {
  el.className = "";
  if (!ms) return;
  const overall = Math.min(...Object.values(sectorBests).map((b) => b[key] || Infinity));
  const own = sectorBests[idx]?.[key] || Infinity;
  el.className = ms <= overall ? "purple" : ms <= own ? "pb" : "slow";
}

function renderCars(cars) {
  const fastest = Math.min(...cars.map((c) => c.bestLapMs || Infinity));
  $("cars").innerHTML = cars.map((c) => `
    <tr class="${c.isPlayer ? "me" : ""}">
      <td>${c.position}</td>
      <td class="name">${escapeHtml(c.name || `#${c.idx}`)}</td>
      <td>${c.position === 1 ? "Leader" : fmtGap(c.gapLeaderMs)}</td>
      <td>${c.position === 1 ? "–" : fmtGap(c.intervalMs)}</td>
      <td>${fmtLap(c.lastLapMs)}</td>
      <td class="${c.bestLapMs && c.bestLapMs === fastest ? "purple" : ""}">${fmtLap(c.bestLapMs)}</td>
      <td><span class="dot" style="--c:${COMPOUND[c.compound] || "var(--line)"}"></span>${c.tyreAge} kör</td>
      <td class="${c.pitStatus ? "pit" : ""}">${c.pitStatus ? "boxban" : c.pits}</td>
      <td>${ERS_HU[c.ersMode] || "–"}</td>
    </tr>`).join("");
}

function renderEvents(events) {
  const list = [...events].reverse();
  $("events").innerHTML = list.length
    ? list.map((e) => `<li class="${["PENA", "COLL", "SCAR", "RDFL"].includes(e.code) ? "hot" : ""}"><time>${fmtClock(e.t)}</time>${escapeHtml(e.text)}</li>`).join("")
    : `<li>Még nem történt semmi ebben a sessionben.</li>`;
}
const fmtClock = (t) => {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- trace ----------
function pushTrace(p) {
  const now = performance.now();
  trace.push({ t: now, speed: p.speed, thr: p.throttle, brk: p.brake });
  while (trace.length && now - trace[0].t > TRACE_SECONDS * 1000) trace.shift();
}

const canvas = $("trace");
const ctx = canvas.getContext("2d");
function drawTrace() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const now = performance.now();
  const x = (t) => w - ((now - t) / (TRACE_SECONDS * 1000)) * w;
  const pad = 12, ph = h - pad * 2;

  ctx.strokeStyle = css.getPropertyValue("--line");
  ctx.lineWidth = 1;
  for (let s = 5; s < TRACE_SECONDS; s += 5) {
    const gx = Math.round(w - (s / TRACE_SECONDS) * w) + 0.5;
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
  }
  if (trace.length > 1) {
    const area = (key, color) => {
      ctx.beginPath();
      ctx.moveTo(x(trace[0].t), h - pad);
      for (const pt of trace) ctx.lineTo(x(pt.t), h - pad - pt[key] * ph * 0.45);
      ctx.lineTo(x(trace[trace.length - 1].t), h - pad);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.45; ctx.fill(); ctx.globalAlpha = 1;
    };
    area("thr", css.getPropertyValue("--thr"));
    area("brk", css.getPropertyValue("--brk"));
    ctx.beginPath();
    trace.forEach((pt, i) => {
      const y = h - pad - Math.min(pt.speed / 360, 1) * ph;
      i ? ctx.lineTo(x(pt.t), y) : ctx.moveTo(x(pt.t), y);
    });
    ctx.strokeStyle = css.getPropertyValue("--chalk");
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  requestAnimationFrame(drawTrace);
}
requestAnimationFrame(drawTrace);

loadFeeds();
setInterval(loadFeeds, 5000);
