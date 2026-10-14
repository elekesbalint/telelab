// Team Telem: multi-panel live engineering view for the selected feed.
import { initNav, escapeHtml } from "./nav.js";
import { mountFeedPick, preferredFeedPort } from "./feed-pick.js";
import { fmtLap, fmtDelta } from "./fmt.js";

const $ = (id) => document.getElementById(id);
const WEATHER = ["Clear", "Light cloud", "Overcast", "Light rain", "Heavy rain", "Storm"];
const COMPOUND = { Soft: "var(--soft)", Medium: "var(--medium)", Hard: "var(--hard)", Inter: "var(--inter)", Wet: "var(--wet)" };
const LETTER = { Soft: "S", Medium: "M", Hard: "H", Inter: "I", Wet: "W" };
const HOT = new Set(["PENA", "COLL", "SCAR", "RDFL", "RTMT"]);
const RACE_TYPES = new Set([15, 16, 17]);
const fmtGap = (ms) => (ms ? `+${(ms / 1000).toFixed(3)}` : "–");
const fmtSec = (ms) => (ms ? (ms / 1000).toFixed(3) : "–");
const dmgCls = (v) => (v >= 30 ? "bad" : v > 0 ? "warn" : "good");
const ersCls = (p) => (p >= 50 ? "good" : p >= 20 ? "warn" : "bad");

const me = await initNav();
if (!me) throw new Error("auth");

let ws = null, port = null, doc = null, slow = null, tab = "strategy", rivalIdx = -1;
/** Current-lap input samples for the Inputs scrubber (distance-based). */
const lapSamples = [];
let scrubIdx = -1;
let lastSampleLap = 0;
let inputsBound = false;

const picker = mountFeedPick($("feed-pick"), {
  preferredPort: preferredFeedPort(me.udpPort ?? null),
  onChange: (p) => connect(p),
});
picker.refresh();
setInterval(() => picker.refresh(), 5000);

$("tabs").onclick = (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  tab = b.dataset.tab;
  for (const x of $("tabs").querySelectorAll("[data-tab]")) x.classList.toggle("on", x === b);
  for (const p of document.querySelectorAll(".tt-panel")) p.hidden = p.dataset.show !== tab;
  if (tab === "inputs") { bindInputs(); drawInputs(); }
  if (tab === "rival") { renderRival(); drawRivalChart(); }
};

$("tt-warn-only").onchange = () => renderEvents();
$("tt-rival").onchange = () => {
  rivalIdx = Number($("tt-rival").value);
  renderRival();
  drawRivalChart();
};

function connect(p) {
  if (p == null) return;
  port = p;
  doc = null; slow = null; rivalIdx = -1; lapSamples.length = 0; scrubIdx = -1; lastSampleLap = 0;
  if (ws) { ws.onclose = null; ws.close(); }
  setConn("off", "Connecting…");
  showEmpty(true);
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/feeds/${p}/workbench`);
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.slow) slow = d.slow;
    doc = d;
    pushInputSample(d);
    const stale = d.ageMs > 3000;
    setConn(stale ? "stale" : "live", stale ? `Last data ${Math.round(d.ageMs / 1000)} s ago` : "Live");
    showEmpty(!d.session);
    if (d.session) render();
  };
  ws.onclose = () => {
    setConn("off", "Connection lost, retrying…");
    setTimeout(() => port === p && connect(p), 3000);
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

function weatherIcon(w) {
  const sun = `<circle cx="12" cy="12" r="5" fill="var(--medium)"/>`;
  const cloud = (fill) => `<path d="M7 18h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.4A3.3 3.3 0 0 0 7 18z" fill="${fill}"/>`;
  const drops = (n) => Array.from({ length: n }, (_, i) => `<line x1="${8 + i * 4}" y1="20" x2="${7 + i * 4}" y2="23" stroke="var(--wet)" stroke-width="1.6" stroke-linecap="round"/>`).join("");
  const body = [sun, sun + cloud("var(--dim)"), cloud("var(--dim)"), cloud("var(--dim)") + drops(2),
    cloud("var(--line)") + drops(3), cloud("var(--line)") + drops(3)][w] || sun;
  return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${body}</svg>`;
}

function isRace() {
  return RACE_TYPES.has(doc?.session?.sessionType);
}

function render() {
  const s = doc.session || {};
  const left = s.timeLeft != null ? `${Math.floor(s.timeLeft / 60)}:${String(s.timeLeft % 60).padStart(2, "0")}` : "";
  const lap = doc.player?.lap ?? "–";
  $("session").textContent = [s.track, s.type].filter(Boolean).join(" · ");
  $("meta").textContent = [s.track, s.type, s.totalLaps > 1 ? `Lap ${lap}/${s.totalLaps}` : `Lap ${lap}`, left,
    `${WEATHER[s.weather] || "–"} ${s.airTemp}° air ${s.trackTemp}° track`].filter(Boolean).join(" · ");

  const theo = s.theoreticalBestMs ? fmtLap(s.theoreticalBestMs) : "–";
  $("sum").hidden = false;
  $("sum").innerHTML = `<span class="good">Time remaining ${left || "–"}</span>
    <span>Theoretical best: <b class="amber">${theo}</b></span>
    <span class="good">Cars on track ${s.carsOnTrack ?? "–"}</span>
    <span>Pit limit ${s.pitSpeed ?? "–"} km/h</span>
    <span>Air ${s.airTemp ?? "–"}°C · Track ${s.trackTemp ?? "–"}°C</span>`;

  renderWeather();
  renderRain();
  renderTyres();
  renderEvents();
  renderSession();
  renderQTiming();
  renderTiming();
  renderVehicle();
  renderRival();
  renderSetup();
  if (tab === "inputs") { bindInputs(); drawInputs(); }
  if (tab === "rival") drawRivalChart();
}

function pushInputSample(d) {
  const f = d.focus;
  if (!f || f.restricted) return;
  const dist = f.lapDistance ?? 0;
  const lap = f.lap ?? 0;
  if (lap && lap !== lastSampleLap) {
    lapSamples.length = 0;
    scrubIdx = -1;
    lastSampleLap = lap;
  }
  if (dist < 0) return;
  // Flashback / new lap: distance dropped a lot.
  if (lapSamples.length && dist + 80 < lapSamples.at(-1).dist) {
    lapSamples.length = 0;
    scrubIdx = -1;
  }
  const last = lapSamples.at(-1);
  if (last && Math.abs(last.dist - dist) < 0.8) {
    Object.assign(last, sampleFromFocus(f));
    return;
  }
  lapSamples.push(sampleFromFocus(f));
  if (lapSamples.length > 8000) lapSamples.splice(0, lapSamples.length - 8000);
}

function sampleFromFocus(f) {
  return {
    dist: f.lapDistance ?? 0,
    thr: f.throttle ?? 0,
    brk: f.brake ?? 0,
    steer: (f.steer ?? 0) * 180, // game steer is roughly -1..1
    yaw: f.yawDeg ?? 0,
    spd: f.speed ?? 0,
    gear: f.gear ?? 0,
    ers: f.ersPct ?? 0,
    ersMode: f.ersMode || "",
    name: f.name || "",
    x: f.x ?? 0,
    z: f.z ?? 0,
  };
}

function renderWeather() {
  const f = (slow?.forecast || []).filter((x) => !doc.session?.type || x.session === doc.session.type);
  const list = f.length ? f : (slow?.forecast || []);
  if (!list.length) {
    $("tt-weather").innerHTML = `<p class="dv-muted">No forecast yet.</p>`;
    return;
  }
  $("tt-weather").innerHTML = `<div class="dv-wx-row">${list.slice(0, 13).map((x, i) =>
    `<div class="dv-wx"><span>${i === 0 ? "Now" : `+${x.offset}m`}</span>${weatherIcon(x.weather)}<b>${x.rain}%</b><small>${x.trackTemp}° / ${x.airTemp}°</small></div>`
  ).join("")}</div>`;
}

function renderRain() {
  const f = slow?.forecast || [];
  if (!f.length) {
    $("tt-rain").innerHTML = `<p class="dv-muted">Waiting for forecast samples.</p>`;
    return;
  }
  const W = 900, H = 160, pad = 28;
  const maxOff = Math.max(1, ...f.map((x) => x.offset));
  const maxT = Math.max(20, ...f.map((x) => Math.max(x.trackTemp, x.airTemp)));
  const minT = Math.min(0, ...f.map((x) => Math.min(x.trackTemp, x.airTemp)));
  const X = (o) => pad + (o / maxOff) * (W - pad - 10);
  const Yt = (t) => H - 18 - ((t - minT) / (maxT - minT || 1)) * (H - 36);
  const Yr = (r) => H - 18 - (r / 100) * (H - 36);
  const poly = (pts, stroke) => pts.length
    ? `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${stroke}" stroke-width="2"/>`
    : "";
  $("tt-rain").innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="tt-chart" role="img" aria-label="Rain and temperature forecast">
    ${poly(f.map((x) => [X(x.offset), Yt(x.trackTemp)]), "var(--hot)")}
    ${poly(f.map((x) => [X(x.offset), Yt(x.airTemp)]), "var(--medium)")}
    ${poly(f.map((x) => [X(x.offset), Yr(x.rain)]), "var(--cold)")}
    <text x="10" y="14" fill="var(--hot)" font-size="11">Track</text>
    <text x="60" y="14" fill="var(--medium)" font-size="11">Air</text>
    <text x="100" y="14" fill="var(--cold)" font-size="11">Rain %</text>
  </svg>`;
}

function renderTyres() {
  const sets = slow?.tyreSets || [];
  if (!sets.length) {
    $("tt-tyres").innerHTML = `<p class="dv-muted">Tyre set data is only sent for your own car.</p>`;
    return;
  }
  $("tt-tyres").innerHTML = sets.map((t) => {
    const letter = LETTER[t.visual] || "?";
    const delta = t.fitted ? "fitted" : fmtDelta(t.lapDeltaMs);
    return `<div class="tt-tyre ${t.fitted ? "fitted" : ""} ${t.available ? "" : "gone"}" style="--c:${COMPOUND[t.visual] || "var(--line)"}">
      <b class="tt-tyre-badge">${letter}</b>
      <span>${escapeHtml(t.actual || t.visual)}</span>
      <em>${t.wear}%</em>
      <small>${delta}</small>
    </div>`;
  }).join("");
}

function renderEvents() {
  const only = $("tt-warn-only").checked;
  let list = [...(doc.events || [])].reverse();
  if (only) list = list.filter((e) => HOT.has(e.code));
  $("tt-events").innerHTML = list.length
    ? list.map((e) => `<li class="${HOT.has(e.code) ? "hot" : ""}"><time>${fmtClock(e.t)}</time>${escapeHtml(e.text)}</li>`).join("")
    : `<li class="dv-muted">${only ? "No warnings or penalties." : "No race control messages yet."}</li>`;
}

function renderSession() {
  const s = doc.session || {};
  const rows = [
    ["Track", s.track], ["Session", s.type], ["Weather", WEATHER[s.weather]],
    ["Air", `${s.airTemp} °C`], ["Track temp", `${s.trackTemp} °C`],
    ["Pit limit", `${s.pitSpeed ?? "–"} km/h`], ["Cars", s.carsOnTrack],
    ["Online", s.online ? "yes" : "no"],
  ];
  $("tt-session").innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(String(v ?? "–"))}</dd></div>`).join("");
}

function sectorClass(ms, pb, best) {
  if (!ms) return "";
  if (best && ms === best) return "purple";
  if (pb && ms === pb) return "good";
  return "";
}

function renderQTiming() {
  const cars = doc.cars || [];
  const s = doc.session || {};
  const bestS = [s.bestS1, s.bestS2, s.bestS3];
  const leaderBest = Math.min(...cars.map((c) => c.bestLapMs || Infinity));
  $("tt-qtiming").innerHTML = cars.map((c) => {
    const gap = c.bestLapMs && leaderBest < Infinity && c.bestLapMs !== leaderBest
      ? fmtGap(c.bestLapMs - leaderBest) : (c.position === 1 ? "–" : fmtGap(c.gapLeaderMs));
    return `<tr class="${c.isPlayer ? "me" : ""}">
      <td>${c.position}</td>
      <td class="name"><i class="tt-team" style="background:${escapeHtml(c.color || "var(--line)")}"></i>${escapeHtml(c.name || `#${c.idx}`)}</td>
      <td class="dim">${escapeHtml(c.team || "–")}</td>
      <td class="${c.bestLapMs && c.bestLapMs === leaderBest ? "purple" : "amber"}">${fmtLap(c.bestLapMs)}</td>
      <td>${gap}</td>
      <td class="${sectorClass(c.bestS1, c.pbS1, bestS[0])}">${fmtSec(c.bestS1)}</td>
      <td class="${sectorClass(c.bestS2, c.pbS2, bestS[1])}">${fmtSec(c.bestS2)}</td>
      <td class="${sectorClass(c.bestS3, c.pbS3, bestS[2])}">${fmtSec(c.bestS3)}</td>
      <td>${c.speedTrap ? c.speedTrap.toFixed(0) : "–"}</td>
      <td>${c.laps ?? 0}</td>
      <td><span class="tt-tyre-pill" style="--c:${COMPOUND[c.compound] || "var(--line)"}">${escapeHtml(c.compound || "–")}</span></td>
      <td class="dim">${escapeHtml(c.status || "")}</td>
    </tr>`;
  }).join("");
}

function renderTiming() {
  const race = isRace();
  $("tt-race-note").hidden = race;
  $("tt-timing").closest(".table-wrap").hidden = !race;
  if (!race) {
    $("tt-timing").innerHTML = "";
    return;
  }
  const cars = doc.cars || [];
  const fastest = Math.min(...cars.map((c) => c.bestLapMs || Infinity));
  $("tt-timing").innerHTML = cars.map((c) => `
    <tr class="${c.isPlayer ? "me" : ""}">
      <td>${c.position}</td>
      <td class="name"><i class="tt-team" style="background:${escapeHtml(c.color || "var(--line)")}"></i>${escapeHtml(c.name || `#${c.idx}`)}</td>
      <td>${fmtSec(c.curS1)}</td>
      <td>${fmtSec(c.curS2)}</td>
      <td>–</td>
      <td>${fmtLap(c.lastLapMs)}</td>
      <td>${c.position === 1 ? "Leader" : fmtGap(c.gapLeaderMs)}</td>
      <td>${c.position === 1 ? "–" : fmtGap(c.intervalMs)}</td>
      <td>${c.pits ?? 0}</td>
      <td class="${c.bestLapMs && c.bestLapMs === fastest ? "purple" : ""}">${fmtLap(c.bestLapMs)}</td>
      <td><span class="tt-tyre-pill" style="--c:${COMPOUND[c.compound] || "var(--line)"}">${escapeHtml(c.compound || "–")}</span></td>
      <td>${c.tyreAge ?? 0}</td>
    </tr>`).join("");
}

function renderVehicle() {
  const cars = doc.cars || [];
  $("tt-vehicle").innerHTML = cars.map((c) => `
    <tr class="${c.isPlayer ? "me" : ""}">
      <td>${c.position}</td>
      <td class="name"><i class="tt-team" style="background:${escapeHtml(c.color || "var(--line)")}"></i>${escapeHtml(c.name || `#${c.idx}`)}</td>
      <td class="${dmgCls(c.wingFL)}">${c.wingFL ?? 0}%</td>
      <td class="${dmgCls(c.wingFR)}">${c.wingFR ?? 0}%</td>
      <td class="${dmgCls(c.wingRW)}">${c.wingRW ?? 0}%</td>
      <td>${escapeHtml(c.ersMode || "–")}</td>
      <td class="${ersCls(c.ersPct ?? 0)}">${Math.round(c.ersPct ?? 0)}%</td>
      <td class="warn">${c.warnings ?? 0} (${c.cornerCut ?? 0} CC)</td>
      <td class="${c.penaltiesSec ? "bad" : "dim"}">${c.penaltiesSec ? `${c.penaltiesSec}s` : "–"}</td>
    </tr>`).join("");
}

function lapsFor(idx) {
  const row = (slow?.lapMatrix || []).find((r) => r.idx === idx);
  return (row?.laps || []).map((l) => l.ms).filter((ms) => ms > 0);
}

function renderRival() {
  const cars = doc.cars || [];
  const player = cars.find((c) => c.isPlayer) || cars[0];
  const sel = $("tt-rival");
  const options = cars.filter((c) => !c.isPlayer);
  const prev = rivalIdx;
  sel.innerHTML = `<option value="-1">Select rival…</option>` +
    options.map((c) => `<option value="${c.idx}">P${c.position} ${escapeHtml(c.name || "")}</option>`).join("");
  if (prev >= 0 && options.some((c) => c.idx === prev)) rivalIdx = prev;
  else rivalIdx = -1;
  sel.value = String(rivalIdx);

  const rival = cars.find((c) => c.idx === rivalIdx);
  if (!player || !rival) {
    $("tt-rival-info").innerHTML = `<p class="dv-muted">Select a rival to compare</p><p class="dv-muted">No car data</p>`;
  } else {
    const card = (c, title) => `<div class="tt-rival-card">
      <span class="lab">${title}</span>
      <b>${escapeHtml(c.name)}</b>
      <p>P${c.position} · best ${fmtLap(c.bestLapMs)} · last ${fmtLap(c.lastLapMs)}</p>
      <p>${escapeHtml(c.compound || "–")} ${c.tyreAge ?? 0}L · ERS ${Math.round(c.ersPct ?? 0)}% · wear ${(c.maxWear ?? 0).toFixed(0)}%</p>
    </div>`;
    $("tt-rival-info").innerHTML = card(player, "Personal") + card(rival, "Rival");
  }

  $("tt-rival-table").innerHTML = cars.map((c) => `
    <tr class="${c.isPlayer ? "me" : ""} ${c.idx === rivalIdx ? "rival" : ""}">
      <td>${c.position}</td>
      <td class="name">${escapeHtml(c.name || `#${c.idx}`)}</td>
      <td>${fmtLap(c.bestLapMs)}</td>
      <td>${fmtLap(c.lastLapMs)}</td>
      <td>${c.pits ?? 0}</td>
      <td><span class="tt-tyre-pill" style="--c:${COMPOUND[c.compound] || "var(--line)"}">${escapeHtml(c.compound || "–")}</span></td>
      <td>${(c.maxWear ?? 0).toFixed(0)}%</td>
      <td class="${ersCls(c.ersPct ?? 0)}">${Math.round(c.ersPct ?? 0)}%</td>
      <td>${(c.fuel ?? 0).toFixed(1)}</td>
      <td class="${dmgCls(c.wingFL)}">${c.wingFL ?? 0}%</td>
      <td class="${dmgCls(c.wingFR)}">${c.wingFR ?? 0}%</td>
      <td class="${dmgCls(c.wingRW)}">${c.wingRW ?? 0}%</td>
      <td class="${c.penaltiesSec ? "bad" : "dim"}">${c.penaltiesSec ?? 0}</td>
      <td class="warn">${c.warnings ?? 0}</td>
    </tr>`).join("");
}

function drawRivalChart() {
  const cv = $("tt-rival-chart");
  if (!cv || !doc) return;
  const player = (doc.cars || []).find((c) => c.isPlayer);
  const rival = (doc.cars || []).find((c) => c.idx === rivalIdx);
  const a = player ? lapsFor(player.idx) : [];
  const b = rival ? lapsFor(rival.idx) : [];
  const dpr = devicePixelRatio || 1;
  const w = cv.clientWidth || 900, h = cv.clientHeight || 200;
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const all = [...a, ...b];
  if (!all.length) {
    ctx.fillStyle = css.getPropertyValue("--dim");
    ctx.font = "13px IBM Plex Sans";
    ctx.fillText(rival ? "No completed laps yet." : "Select a rival to compare lap times.", 12, 28);
    return;
  }
  const n = Math.max(a.length, b.length, 1);
  const min = Math.min(...all), max = Math.max(...all);
  const pad = { l: 54, r: 12, t: 16, b: 28 };
  const X = (i) => pad.l + (i / Math.max(n - 1, 1)) * (w - pad.l - pad.r);
  const Y = (ms) => pad.t + (1 - (ms - min) / (max - min || 1)) * (h - pad.t - pad.b);
  ctx.strokeStyle = css.getPropertyValue("--line");
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const y = pad.t + (i / 3) * (h - pad.t - pad.b);
    ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y);
  }
  ctx.stroke();
  ctx.fillStyle = css.getPropertyValue("--dim");
  ctx.font = "11px Saira Semi Condensed";
  ctx.fillText(fmtLap(min), 4, h - pad.b);
  ctx.fillText(fmtLap(max), 4, pad.t + 10);
  const draw = (arr, color) => {
    if (arr.length < 2) return;
    ctx.beginPath();
    arr.forEach((ms, i) => { const x = X(i), y = Y(ms); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    arr.forEach((ms, i) => {
      ctx.beginPath(); ctx.arc(X(i), Y(ms), 3, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    });
  };
  draw(a, css.getPropertyValue("--amber"));
  draw(b, css.getPropertyValue("--cold"));
}

function renderSetup() {
  const s = slow?.setup;
  if (!s) {
    $("tt-setup").innerHTML = `<p class="dv-muted">Setup is only sent for your own car.</p>`;
    return;
  }
  const g = (title, rows) => `<div class="tt-setup-g"><h3>${title}</h3>${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>`;
  $("tt-setup").innerHTML = `<div class="tt-setup-grid">${[
    g("Aero", [["Front wing", s.FrontWing], ["Rear wing", s.RearWing]]),
    g("Differential", [["On throttle", s.OnThrottle], ["Off throttle", s.OffThrottle]]),
    g("Suspension", [["Front", s.FrontSusp], ["Rear", s.RearSusp], ["Front ARB", s.FrontARB], ["Rear ARB", s.RearARB]]),
    g("Brakes", [["Pressure", s.BrakePressure], ["Bias", s.BrakeBias]]),
    g("Fuel", [["Load", s.FuelLoad?.toFixed?.(1) ?? s.FuelLoad]]),
  ].join("")}</div>`;
}

function bindInputs() {
  if (inputsBound) return;
  const stack = $("tt-chart-stack");
  if (!stack) return;
  inputsBound = true;
  const onMove = (e) => {
    const box = e.currentTarget;
    const cv = box.querySelector("canvas");
    if (!cv || lapSamples.length < 2) return;
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const i = Math.round((x / Math.max(rect.width, 1)) * (lapSamples.length - 1));
    scrubIdx = Math.max(0, Math.min(lapSamples.length - 1, i));
    drawInputs();
  };
  const onLeave = () => {
    scrubIdx = -1;
    drawInputs();
  };
  for (const box of stack.querySelectorAll(".tt-chart-box")) {
    box.addEventListener("mousemove", onMove);
    box.addEventListener("mouseleave", onLeave);
  }
}

function drawInputs() {
  drawInputCharts();
  drawInputMaps();
  paintScrub();
}

function paintScrub() {
  const tip = $("tt-tip");
  const scrub = $("tt-scrub");
  const i = scrubIdx >= 0 ? scrubIdx : lapSamples.length - 1;
  const s = lapSamples[i];
  if (!s) {
    scrub.textContent = "Drive a lap — charts fill from your live inputs";
    tip.hidden = true;
    return;
  }
  const gear = s.gear < 0 ? "R" : s.gear === 0 ? "N" : String(s.gear);
  const line = `dist ${s.dist.toFixed(0)} m · Spd ${s.spd} · Thr ${(s.thr * 100).toFixed(0)}% · Brk ${(s.brk * 100).toFixed(0)}% · Gear ${gear} · Steer ${s.steer.toFixed(0)}° · Yaw ${s.yaw.toFixed(0)}° · ERS ${escapeHtml(s.ersMode)} ${s.ers.toFixed(0)}%`;
  scrub.innerHTML = scrubIdx >= 0 ? `<b>${escapeHtml(s.name || "Driver")}</b> · ${line}` : line;
  if (scrubIdx < 0) { tip.hidden = true; return; }
  tip.hidden = false;
  tip.innerHTML = `<b>${escapeHtml(s.name || "Driver")}</b> @ ${s.dist.toFixed(0)} m<br>
    Spd ${s.spd} km/h · Thr ${(s.thr * 100).toFixed(0)}% · Brk ${(s.brk * 100).toFixed(0)}% · Gear ${gear}<br>
    Steer ${s.steer.toFixed(0)}° · Yaw ${s.yaw.toFixed(0)}° · ERS ${escapeHtml(s.ersMode)} · Bat ${s.ers.toFixed(0)}%`;
}

function sizeCanvas(cv) {
  const dpr = devicePixelRatio || 1;
  const w = cv.clientWidth || 400, h = cv.clientHeight || 88;
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function drawInputCharts() {
  const css = getComputedStyle(document.documentElement);
  const n = lapSamples.length;
  const X = (i, w, pad) => pad + (n < 2 ? 0 : (i / (n - 1)) * (w - pad * 2));
  const scrubX = (w, pad) => {
    const i = scrubIdx >= 0 ? scrubIdx : n - 1;
    return n ? X(Math.max(0, i), w, pad) : null;
  };

  const drawSeries = (box, series) => {
    const cv = box.querySelector("canvas");
    if (!cv) return;
    const { ctx, w, h } = sizeCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    const pad = 8;
    if (n < 2) {
      ctx.fillStyle = css.getPropertyValue("--dim");
      ctx.font = "12px IBM Plex Sans";
      ctx.fillText("Waiting for lap data…", 10, 20);
      return;
    }
    for (const s of series) {
      const vals = lapSamples.map((p) => s.val(p));
      const lo = s.min ?? Math.min(...vals), hi = s.max ?? Math.max(...vals);
      const span = hi - lo || 1;
      const Y = (v) => h - pad - ((v - lo) / span) * (h - pad * 2);
      ctx.beginPath();
      lapSamples.forEach((p, i) => {
        const x = X(i, w, pad), y = Y(s.val(p));
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.strokeStyle = s.color; ctx.lineWidth = 1.6; ctx.stroke();
      if (s.fill) {
        ctx.lineTo(X(n - 1, w, pad), h - pad); ctx.lineTo(X(0, w, pad), h - pad); ctx.closePath();
        ctx.fillStyle = s.fill; ctx.globalAlpha = 0.22; ctx.fill(); ctx.globalAlpha = 1;
      }
    }
    const sx = scrubX(w, pad);
    if (sx != null) {
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
      ctx.strokeStyle = scrubIdx >= 0 ? css.getPropertyValue("--brk") : css.getPropertyValue("--cold");
      ctx.lineWidth = scrubIdx >= 0 ? 1.5 : 1; ctx.stroke();
    }
  };

  for (const box of document.querySelectorAll("#tt-chart-stack .tt-chart-box")) {
    const kind = box.dataset.chart;
    if (kind === "thr") {
      drawSeries(box, [
        { val: (p) => p.thr * 100, min: 0, max: 100, color: css.getPropertyValue("--cold"), fill: css.getPropertyValue("--cold") },
        { val: (p) => p.brk * 100, min: 0, max: 100, color: css.getPropertyValue("--brk"), fill: css.getPropertyValue("--brk") },
      ]);
    } else if (kind === "steer") {
      drawSeries(box, [{ val: (p) => p.steer, color: css.getPropertyValue("--cold") }]);
    } else if (kind === "yaw") {
      drawSeries(box, [{ val: (p) => p.yaw, color: css.getPropertyValue("--cold") }]);
    } else if (kind === "spd") {
      drawSeries(box, [{ val: (p) => p.spd, min: 0, max: 360, color: css.getPropertyValue("--chalk") }]);
    } else if (kind === "gear") {
      drawSeries(box, [{ val: (p) => p.gear, min: -1, max: 8, color: css.getPropertyValue("--amber") }]);
    } else if (kind === "ers") {
      drawSeries(box, [{ val: (p) => p.ers, min: 0, max: 100, color: css.getPropertyValue("--thr") }]);
    }
  }

  // Position tooltip near the scrubber column of the stack.
  const tip = $("tt-tip");
  const stack = $("tt-chart-stack");
  if (tip && stack && scrubIdx >= 0 && n > 1) {
    const rect = stack.getBoundingClientRect();
    const pad = 8;
    const x = pad + (scrubIdx / (n - 1)) * (rect.width - pad * 2);
    tip.style.left = `${Math.min(Math.max(8, x + 12), rect.width - 200)}px`;
    tip.style.top = `40px`;
  }
}

function mapProject(pts, w, h, pad = 18) {
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const sc = Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxZ - minZ || 1));
  const ox = (w - (maxX - minX) * sc) / 2, oy = (h - (maxZ - minZ) * sc) / 2;
  return (x, z) => [ox + (x - minX) * sc, h - (oy + (z - minZ) * sc)];
}

function drawInputMaps() {
  const css = getComputedStyle(document.documentElement);
  const outline = slow?.outline || [];
  const i = scrubIdx >= 0 ? scrubIdx : lapSamples.length - 1;
  const cur = lapSamples[i];
  const trail = lapSamples.filter((p) => p.x || p.z).map((p) => [p.x, p.z]);
  const pts = outline.length >= 8 ? outline : trail;

  const drawMap = (cvId, zoom) => {
    const cv = $(cvId);
    if (!cv) return;
    const { ctx, w, h } = sizeCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    if (!pts.length) {
      ctx.fillStyle = css.getPropertyValue("--dim");
      ctx.font = "12px IBM Plex Sans";
      ctx.fillText("Track outline builds as you drive", 12, 22);
      return;
    }
    let view = pts;
    if (zoom && cur && (cur.x || cur.z)) {
      const r = 120;
      view = pts.filter(([x, z]) => Math.hypot(x - cur.x, z - cur.z) < r);
      if (view.length < 4) view = pts;
    }
    const P = mapProject(view, w, h);
    if (!P) return;
    ctx.strokeStyle = css.getPropertyValue("--dim");
    ctx.lineWidth = zoom ? 3 : 6;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    view.forEach(([x, z], k) => { const [a, b] = P(x, z); k ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
    if (!zoom && outline.length >= 8) ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (trail.length > 1 && !zoom) {
      ctx.beginPath();
      trail.forEach(([x, z], k) => { const [a, b] = P(x, z); k ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
      ctx.strokeStyle = css.getPropertyValue("--cold"); ctx.lineWidth = 1.5; ctx.globalAlpha = 0.7; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (cur && (cur.x || cur.z)) {
      const [a, b] = P(cur.x, cur.z);
      ctx.beginPath(); ctx.arc(a, b, zoom ? 7 : 6, 0, Math.PI * 2);
      ctx.fillStyle = css.getPropertyValue("--cold"); ctx.fill();
      ctx.strokeStyle = css.getPropertyValue("--chalk"); ctx.lineWidth = 2; ctx.stroke();
    }
  };
  drawMap("tt-map", false);
  drawMap("tt-zoom", true);
}

const fmtClock = (t) => {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

requestAnimationFrame(function loop() {
  if (!$("live").hidden) {
    if (tab === "inputs") drawInputs();
    if (tab === "rival") drawRivalChart();
  }
  requestAnimationFrame(loop);
});
