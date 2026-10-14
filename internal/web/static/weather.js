// Weather page: briefing, radar, grip and tyre sets from the workbench feed.
import { initNav, escapeHtml } from "./nav.js";
import { mountFeedPick, preferredFeedPort } from "./feed-pick.js";
import { fmtDelta } from "./fmt.js";

const $ = (id) => document.getElementById(id);
const WEATHER = ["Clear", "Light cloud", "Overcast", "Light rain", "Heavy rain", "Storm"];
const COMPOUND = { Soft: "var(--soft)", Medium: "var(--medium)", Hard: "var(--hard)", Inter: "var(--inter)", Wet: "var(--wet)" };
const LETTER = { Soft: "S", Medium: "M", Hard: "H", Inter: "I", Wet: "W" };
const SURFACE = ["Tarmac", "Rumble", "Concrete", "Rock", "Gravel", "Mud", "Sand", "Grass", "Water", "Cobble", "Metal", "Ridged"];
const WHEELS = [
  { i: 2, label: "FL" }, { i: 3, label: "FR" },
  { i: 0, label: "RL" }, { i: 1, label: "RR" },
];
const GRIP_WHEELS = [
  { i: 0, label: "RL" }, { i: 1, label: "RR" },
  { i: 2, label: "FL" }, { i: 3, label: "FR" },
];

const me = await initNav();
if (!me) throw new Error("auth");

let ws = null, port = null, doc = null, slow = null;
const rainHist = [];
const muHist = [];
let lastWxKey = null, lastWxAt = 0;

const picker = mountFeedPick($("feed-pick"), {
  preferredPort: preferredFeedPort(me.udpPort ?? null),
  onChange: (p) => connect(p),
});
picker.refresh();
setInterval(() => picker.refresh(), 5000);

function connect(p) {
  if (p == null) return;
  port = p;
  doc = null; slow = null;
  rainHist.length = 0; muHist.length = 0;
  lastWxKey = null;
  if (ws) { ws.onclose = null; ws.close(); }
  setConn("off", "Connecting…");
  showEmpty(true);
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/feeds/${p}/workbench`);
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.slow) slow = d.slow;
    doc = d;
    if (d.session) {
      const now = d.session.rainNow ?? 0;
      const t = Date.now();
      rainHist.push([t, now]);
      while (rainHist.length && t - rainHist[0][0] > 120000) rainHist.shift();
      const key = `${d.session.weather}|${now}`;
      if (key !== lastWxKey) { lastWxKey = key; lastWxAt = t; }
      const mu = avgMu(d.focus);
      if (mu != null) {
        muHist.push([t, mu]);
        while (muHist.length && t - muHist[0][0] > 10000) muHist.shift();
      }
    }
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

function avgMu(focus) {
  const m = focus?.gripMu;
  if (!m) return null;
  return (m[0] + m[1] + m[2] + m[3]) / 4;
}

let wxIcoSeq = 0;
function weatherIcon(w, size = 40) {
  const uid = `wi${++wxIcoSeq}`;
  const sun = (cx, cy, r) => {
    const rays = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const r0 = r + 4, r1 = r + 13;
      return `<line x1="${(cx + Math.cos(a) * r0).toFixed(1)}" y1="${(cy + Math.sin(a) * r0).toFixed(1)}"
        x2="${(cx + Math.cos(a) * r1).toFixed(1)}" y2="${(cy + Math.sin(a) * r1).toFixed(1)}"
        stroke="#f2a93b" stroke-width="2.6" stroke-linecap="round"/>`;
    }).join("");
    return `<defs>
      <radialGradient id="${uid}s" cx="36%" cy="32%" r="68%">
        <stop offset="0%" stop-color="#ffe28a"/><stop offset="70%" stop-color="#f2a93b"/><stop offset="100%" stop-color="#e07818"/>
      </radialGradient>
    </defs>
    ${rays}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${uid}s)"/>
    <circle cx="${cx - r * 0.25}" cy="${cy - r * 0.28}" r="${r * 0.22}" fill="#fff4c8" opacity=".5"/>`;
  };
  const cloud = (fill, ox = 0, oy = 0) =>
    `<path transform="translate(${ox} ${oy})" d="M16 42h28a8.5 8.5 0 0 0 .8-17 11.5 11.5 0 0 0-21.6-3.4A8 8 0 0 0 16 42z" fill="${fill}"/>`;
  const drops = (n) => Array.from({ length: n }, (_, i) => {
    const x = 22 + i * (20 / Math.max(1, n - 1));
    return `<path d="M${x} 46c0 0-2 3-2 4.8a2 2 0 1 0 4 0c0-1.8-2-4.8-2-4.8z" fill="#5fa8e8"/>`;
  }).join("");
  const bolt = `<path d="M34 41l-5 8h4l-2.2 8 8.2-11h-4.2z" fill="#f2d03b"/>`;
  let body = "";
  switch (w) {
    case 0: body = sun(32, 32, 11); break;
    case 1: body = sun(44, 18, 8) + cloud("#c9d0da", 0, 2); break;
    case 2: body = cloud("#8e96a2", 2, -4) + cloud("#b7bfc9", -2, 4); break;
    case 3: body = cloud("#b0b8c4") + drops(3); break;
    case 4: body = cloud("#6f7a88") + drops(5); break;
    case 5: body = cloud("#4e5866") + drops(4) + bolt; break;
    default: body = sun(32, 32, 11);
  }
  return `<svg class="wx-ico" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}

function forecastForSession() {
  const all = slow?.forecast || [];
  const type = doc?.session?.type;
  const f = all.filter((x) => !type || x.session === type);
  return f.length ? f : all;
}

function tyreOpts() {
  const sets = (slow?.tyreSets || []).filter((t) => t.available);
  const best = {};
  for (const t of sets) {
    let kind = "dry";
    if (t.visual === "Inter") kind = "inter";
    else if (t.visual === "Wet") kind = "wet";
    if (!best[kind] || t.lapDeltaMs < best[kind].lapDeltaMs) best[kind] = t;
  }
  return best;
}

function rainChangePerMin() {
  if (rainHist.length < 2) return null;
  const [t0, v0] = rainHist[0], [t1, v1] = rainHist.at(-1);
  return t1 - t0 < 20000 ? null : ((v1 - v0) / (t1 - t0)) * 60000;
}

function clock(sec) {
  if (sec == null || sec < 0) return "00:00";
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function pill(cls, text) {
  return `<span class="wx-pill ${cls}">${escapeHtml(text)}</span>`;
}

function render() {
  const s = doc.session || {};
  const f = forecastForSession();
  const now = f[0];
  const rainNow = now?.rain ?? s.rainNow ?? 0;
  const name = WEATHER[s.weather] || "–";
  $("session").textContent = [s.track, s.type].filter(Boolean).join(" · ");

  const rainy = f.some((x) => x.rain > 30 || x.weather >= 3);
  const trackDry = rainNow < 15 && (s.weather ?? 0) < 3;
  const acc = slow?.forecastAccurate;
  const per = rainChangePerMin();
  const trend = per == null ? "STABLE" : Math.abs(per) < 0.3 ? "STABLE" : per > 0 ? "RISING" : "FALLING";
  const elapsed = Math.max(0, (s.duration || 0) - (s.timeLeft || 0));

  const nextChange = f.find((x) => x.offset > 0 && (x.weather !== s.weather || x.rain !== rainNow));
  const agoMin = lastWxAt ? ((Date.now() - lastWxAt) / 60000).toFixed(1) : "–";

  $("wx-brief").innerHTML = `
    <div class="wx-brief-top">
      <div class="wx-brief-hero">
        ${weatherIcon(s.weather, 64)}
        <div>
          <b class="wx-big">${escapeHtml(name)}</b>
          <p class="dv-muted">Forecast accuracy: <em class="${acc ? "wx-ok" : ""}">${acc ? "Perfect" : "Approximate"}</em></p>
        </div>
      </div>
      <div class="wx-brief-mini">${(f.slice(0, 3).length ? f.slice(0, 3) : []).map((x) =>
        `<div>
          <span>+${x.offset}m</span>
          ${weatherIcon(x.weather, 34)}
          <b>${x.trackTemp}°C</b>
          <em>${x.rain}%</em>
        </div>`).join("") || "<span class='dv-muted'>No samples</span>"}</div>
      <div class="wx-brief-temps">
        <div>Track <b>${s.trackTemp ?? "–"}°C</b></div>
        <div>Air <b>${s.airTemp ?? "–"}°C</b></div>
      </div>
    </div>
    <p class="wx-brief-sum">${rainy
      ? "Rain expected — keep intermediates ready."
      : "Dry conditions — standard dry tyre strategy."}</p>`;

  const opts = tyreOpts();
  const dry = opts.dry, inter = opts.inter, wet = opts.wet;
  const fitted = (slow?.tyreSets || []).find((t) => t.fitted);
  const fastest = [dry, inter, wet].filter(Boolean).sort((a, b) => a.lapDeltaMs - b.lapDeltaMs)[0];
  if (!fastest) {
    $("wx-rec").innerHTML = `<p class="dv-muted">Tyre set data is only sent for your own car.</p>`;
  } else {
    const vsFit = fitted && fastest !== fitted
      ? `Fresh ${escapeHtml(fastest.actual || fastest.visual)} ${Math.abs((fastest.lapDeltaMs - fitted.lapDeltaMs) / 1000).toFixed(1)}s faster than current`
      : fastest.fitted ? "Currently on fastest" : "Game prediction";
    $("wx-rec").innerHTML = `
      <p class="wx-kicker">Game prediction</p>
      <div class="wx-rec-head">
        <b class="wx-huge">${escapeHtml(fastest.actual || fastest.visual)}</b>
        ${pill("good", "FASTEST")}
      </div>
      <p class="dv-muted">${escapeHtml(vsFit)}</p>
      <div class="wx-rec-rows">${[["Inter", inter], ["Wet", wet]].map(([lab, t]) => t
        ? `<div><span class="tt-tyre-pill" style="--c:${COMPOUND[t.visual] || "var(--line)"}">${LETTER[t.visual] || lab[0]}</span>
             <span>${escapeHtml(lab)}</span>
             <em>${t === fastest ? "fastest" : fmtDelta(t.lapDeltaMs)}</em></div>`
        : `<div class="dv-muted">${lab}: no set</div>`).join("")}</div>
      <p class="wx-footnote">Based on game lap_delta_ms</p>`;
  }

  $("wx-sum").innerHTML = `
    <div class="wx-sum-hero">
      ${weatherIcon(s.weather, 48)}
      <b class="wx-big">${escapeHtml(name)}</b>
      <dl class="wx-sum-stats">
        <div><dt>Game time</dt><dd>${clock(elapsed)}</dd></div>
        <div><dt>Track</dt><dd>${s.trackTemp ?? "–"}°C</dd></div>
        <div><dt>Rain</dt><dd>${rainNow}%</dd></div>
      </dl>
    </div>
    <p class="wx-sum-meta">
      Accuracy ${pill(acc ? "good" : "", acc ? "PERFECT" : "APPROX")}
      · Last change ${nextChange ? `T+${nextChange.offset}` : "none"} (${agoMin}m ago)
      · Track ${pill(trackDry ? "good" : "warn", trackDry ? "DRY" : "WET")}
    </p>`;

  $("wx-radar-tag").innerHTML = `${s.type ? `<span class="wx-radar-ses">${escapeHtml(s.type)}</span>` : ""}
    ${pill(trackDry ? "good" : "warn", trackDry ? "DRY TYRES" : "WET TYRES")}`;
  $("wx-radar").innerHTML = f.length
    ? `<div class="wx-radar-row">${f.slice(0, 13).map((x) =>
      `<div class="wx-radar-cell">
        <b>${x.rain}%</b>
        ${weatherIcon(x.weather, 28)}
        <span>${x.offset === 0 ? "Now" : `+${x.offset}m`}</span>
      </div>`).join("")}</div>`
    : `<p class="dv-muted">No radar samples yet.</p>`;

  const barH = Math.min(100, rainNow * 5);
  $("wx-rain").innerHTML = `
    <div class="wx-rain-grid">
      <div><p class="wx-kicker">Rain now</p><b class="wx-huge wx-rain-val">${rainNow}%</b></div>
      <div><p class="wx-kicker">Change / min</p><b class="wx-rain-mid">${per == null ? "–" : `${per >= 0 ? "+" : ""}${per.toFixed(1)}%/min`}</b></div>
      <div><p class="wx-kicker">Trend</p>${pill(trend === "STABLE" ? "good" : "warn", trend)}</div>
      <div class="wx-rain-bar" aria-hidden="true"><i style="height:${barH}%"></i></div>
    </div>`;

  renderPrediction(f);
  const risk = rainy ? (f.some((x) => x.rain > 50) ? "HIGH" : "MED") : "LOW";
  const maxWear = Math.max(0, ...(doc.focus?.tyreWear || [0]));
  $("wx-strat-tag").innerHTML = pill(risk === "LOW" ? "good" : risk === "MED" ? "warn" : "bad", risk);
  $("wx-strat").innerHTML = `
    <b class="wx-huge ${rainy ? "wx-warn" : "wx-ok"}">${rainy ? "WEATHER CHANGE" : "CONDITIONS STABLE"}</b>
    <p class="dv-muted">${rainy
      ? "Watch the radar and prepare inters/wets."
      : `Dry conditions, ${maxWear.toFixed(0)}% max wear. No weather changes expected.`}</p>
    <div class="wx-comp-row">${["Soft", "Medium", "Hard", "Inter", "Wet"].map((c) =>
      `<span class="wx-comp" style="--c:${COMPOUND[c]}" title="${c}">${LETTER[c]}</span>`).join("")}</div>`;

  $("wx-timeline").innerHTML = f.length
    ? `<div class="wx-time-row">${f.slice(0, 7).map((x, i) =>
      `<div class="wx-time-cell">
        <span>${i === 0 ? "NOW" : `+${x.offset}M`}</span>
        ${weatherIcon(x.weather, 36)}
        <b>${x.rain}%</b>
        <small>T ${x.trackTemp}°C A ${x.airTemp}°C</small>
      </div>`).join("")}</div>`
    : `<p class="dv-muted">No timeline yet.</p>`;

  const kindLabel = { dry: "DRY", inter: "INT", wet: "WET" };
  const scores = [
    { k: "dry", t: dry, score: dry ? Math.max(0, 100 - Math.abs(dry.lapDeltaMs) / 50) : 0 },
    { k: "inter", t: inter, score: inter ? Math.max(0, 100 - Math.abs(inter.lapDeltaMs) / 50) : (rainNow > 20 ? 40 : 8) },
    { k: "wet", t: wet, score: wet ? Math.max(0, 100 - Math.abs(wet.lapDeltaMs) / 50) : (rainNow > 50 ? 50 : 5) },
  ];
  if (rainNow < 15) scores[0].score = Math.max(scores[0].score, 92);
  const top = [...scores].sort((a, b) => b.score - a.score)[0];
  const coreAvg = doc.focus?.tyreInner
    ? Math.round((doc.focus.tyreInner[0] + doc.focus.tyreInner[1] + doc.focus.tyreInner[2] + doc.focus.tyreInner[3]) / 4)
    : null;
  const gameDelta = top.t ? fmtDelta(top.t.lapDeltaMs) : "–";
  $("wx-best").innerHTML = `
    <p class="wx-kicker">Recommended</p>
    <b class="wx-huge">${kindLabel[top.k]}</b>
    <p class="dv-muted">Best at ${coreAvg ?? "–"}°C. Game delta: ${gameDelta}</p>
    <div class="wx-bars">${scores.map((x) =>
      `<div><span>${kindLabel[x.k]}</span><i><b style="width:${Math.min(100, x.score)}%"></b></i></div>`).join("")}</div>
    <p class="wx-best-meta">Weather: ${escapeHtml(name)} · Track ${s.trackTemp ?? "–"}°C · Air ${s.airTemp ?? "–"}°C · Rain ${rainNow}% · Track ${trackDry ? "DRY" : "WET"} · Trend ${trend}</p>`;

  renderTemps();
  renderGrip();
  renderSets();
}

function renderTemps() {
  const focus = doc.focus;
  if (!focus) {
    $("wx-temps").innerHTML = `<p class="dv-muted">No car telemetry yet.</p>`;
    return;
  }
  const surf = WHEELS.map(({ i }) => focus.tyreSurface?.[i] ?? 0);
  const avg = (a, b) => ((surf[a] + surf[b]) / 2).toFixed(0);
  $("wx-temps").innerHTML = `
    <div class="wx-tyre-map">
      ${WHEELS.map(({ i, label }) => {
        const core = focus.tyreInner?.[i] ?? 0;
        const surface = focus.tyreSurface?.[i] ?? 0;
        const press = focus.tyrePressure?.[i];
        const wear = focus.tyreWear?.[i] ?? 0;
        const cls = core < 70 ? "cold" : core > 105 ? "hot" : "ok";
        return `<div class="wx-tyre ${cls}">
          <span class="wx-tyre-pos">${label}</span>
          <b>${core}°C</b>
          <small>Surface ${surface}°C</small>
          <small>${press != null ? `${press.toFixed(1)} PSI` : "–"}</small>
          <small>Wear ${wear.toFixed(1)}%</small>
        </div>`;
      }).join("")}
      <div class="wx-tyre-mid">
        <em class="tt-tyre-pill" style="--c:${COMPOUND[focus.compound] || "var(--line)"}">${escapeHtml(focus.compound || "–")}</em>
        <span>Age ${focus.tyreAge ?? 0} laps</span>
      </div>
    </div>
    <p class="wx-balance">Balance: Front avg ${avg(0, 1)}°C · Rear avg ${avg(2, 3)}°C · Left avg ${avg(0, 2)}°C · Right avg ${avg(1, 3)}°C</p>`;
}

function renderGrip() {
  const focus = doc.focus;
  if (!focus?.gripMu) {
    $("wx-grip").innerHTML = `<p class="dv-muted">Waiting for motion data.</p>`;
    return;
  }
  const mu = avgMu(focus) ?? 0;
  const peak = muHist.length ? Math.max(...muHist.map((x) => x[1])) : mu;
  const gripPct = Math.max(0, Math.min(100, Math.round((mu / 1.6) * 100)));
  const slip = Math.abs((focus.wheelSlip || [0, 0, 0, 0]).reduce((a, b) => a + b, 0) / 4) * 100;
  const surfIdx = focus.surface?.[2] ?? focus.surface?.[0] ?? 0;
  $("wx-grip").innerHTML = `
    <div class="wx-grip-row">
      <div class="wx-grip-hero">
        <b class="wx-huge wx-grip-pct">${gripPct}%</b>
        <span>Track grip</span>
        <p>μ ${mu.toFixed(3)} · Peak μ (10s) ${peak.toFixed(3)}</p>
      </div>
      ${GRIP_WHEELS.map(({ i, label }) =>
        `<div class="wx-grip-cell"><span>${label}</span><b>${(focus.gripMu[i] ?? 0).toFixed(3)}</b></div>`).join("")}
      <div class="wx-grip-meta">
        <div>Slip <b>${slip.toFixed(2)}%</b></div>
        <div>Surface <b>${escapeHtml(SURFACE[surfIdx] || "?")}</b></div>
        <div>Speed <b>${focus.speed ?? "–"} km/h</b></div>
      </div>
    </div>`;
}

function renderSets() {
  const sets = slow?.tyreSets || [];
  if (!sets.length) {
    $("wx-sets").innerHTML = `<p class="dv-muted">Tyre set data is only sent for your own car.</p>`;
    return;
  }
  $("wx-sets").innerHTML = `<div class="wx-set-row">${sets.map((t) => {
    const letter = LETTER[t.visual] || "?";
    const rec = t.recommended && t.recommended !== "Unknown" ? t.recommended : "None";
    const delta = t.fitted ? "0.000" : fmtDelta(t.lapDeltaMs).replace("+", "+").replace("−", "−");
    return `<div class="wx-set ${t.fitted ? "fitted" : ""} ${t.available ? "" : "gone"}">
      <span class="wx-set-id">Set ${t.index}</span>
      <span class="wx-set-rec">${escapeHtml(rec)}</span>
      <em class="tt-tyre-pill" style="--c:${COMPOUND[t.visual] || "var(--line)"}">${letter}</em>
      <b>${escapeHtml(t.actual || t.visual || "–")}</b>
      <span>${t.wear}%</span>
      <span>${t.lifeSpan}/${t.usableLife}</span>
      <small class="${t.fitted ? "" : t.lapDeltaMs <= 0 ? "wx-ok" : "wx-warn"}">${delta}</small>
    </div>`;
  }).join("")}</div>`;
}

function renderPrediction(f) {
  if (!f.length) {
    $("wx-pred").innerHTML = `<p class="dv-muted">Waiting for forecast samples.</p>`;
    return;
  }
  const W = 920, H = 168, padL = 36, padR = 36, padT = 22, padB = 24;
  const maxOff = Math.max(1, ...f.map((x) => x.offset));
  let maxT = Math.max(...f.map((x) => Math.max(x.trackTemp, x.airTemp)), 20);
  let minT = Math.min(...f.map((x) => Math.min(x.trackTemp, x.airTemp)), maxT - 5);
  minT = Math.floor((minT - 2) / 5) * 5;
  maxT = Math.ceil((maxT + 2) / 5) * 5;
  const X = (o) => padL + (o / maxOff) * (W - padL - padR);
  const Yt = (t) => padT + (1 - (t - minT) / (maxT - minT || 1)) * (H - padT - padB);
  const grid = [];
  for (let t = minT; t <= maxT; t += 5) {
    const y = Yt(t);
    grid.push(`<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--line)" stroke-width="1"/>`);
    grid.push(`<text x="${padL - 6}" y="${y + 3}" text-anchor="end" fill="var(--dim)" font-size="10">${t}°</text>`);
  }
  const poly = (pts, stroke) => pts.length
    ? `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${stroke}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>` : "";
  const rainBars = f.map((x) => {
    const x0 = X(x.offset);
    const h = (x.rain / 100) * 28;
    return `<rect x="${x0 - 3}" y="${H - padB - h}" width="6" height="${h}" rx="1.5" fill="var(--cold)" opacity=".55"/>`;
  }).join("");
  $("wx-pred").innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="wx-chart" role="img" aria-label="Rain and temperature forecast">
    ${grid.join("")}
    ${rainBars}
    ${poly(f.map((x) => [X(x.offset), Yt(x.trackTemp)]), "#f2d03b")}
    ${poly(f.map((x) => [X(x.offset), Yt(x.airTemp)]), "var(--cold)")}
    <g font-size="11" fill="var(--dim)">
      <circle cx="${W - 250}" cy="12" r="3.5" fill="#f2d03b"/><text x="${W - 242}" y="16">Track temp</text>
      <circle cx="${W - 155}" cy="12" r="3.5" fill="var(--cold)"/><text x="${W - 147}" y="16">Air temp</text>
      <circle cx="${W - 72}" cy="12" r="3.5" fill="var(--cold)"/><text x="${W - 64}" y="16">Rain %</text>
    </g>
  </svg>`;
}
