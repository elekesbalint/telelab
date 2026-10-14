// Weather page: live briefing, forecast, tyre recommendation and temps.
import { initNav, escapeHtml } from "./nav.js";
import { mountFeedPick, loadSavedPort } from "./feed-pick.js";
import { fmtDelta } from "./fmt.js";

const $ = (id) => document.getElementById(id);
const WEATHER = ["Clear", "Light cloud", "Overcast", "Light rain", "Heavy rain", "Storm"];
const COMPOUND = { Soft: "var(--soft)", Medium: "var(--medium)", Hard: "var(--hard)", Inter: "var(--inter)", Wet: "var(--wet)" };
const LETTER = { Soft: "S", Medium: "M", Hard: "H", Inter: "I", Wet: "W" };
const WHEELS = [
  { i: 2, label: "FL" }, { i: 3, label: "FR" },
  { i: 0, label: "RL" }, { i: 1, label: "RR" },
];

const me = await initNav();
if (!me) throw new Error("auth");

let ws = null, port = null, doc = null, slow = null;
const rainHist = [];

const picker = mountFeedPick($("feed-pick"), {
  preferredPort: loadSavedPort() ?? me.udpPort ?? null,
  onChange: (p) => connect(p),
});
picker.refresh();
setInterval(() => picker.refresh(), 5000);

function connect(p) {
  if (p == null) return;
  port = p;
  doc = null; slow = null; rainHist.length = 0;
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

let wxIcoSeq = 0;
/** Detailed weather glyphs (not flat dots). viewBox 0 0 64 64. */
function weatherIcon(w, size = 40) {
  const uid = `wi${++wxIcoSeq}`;
  const sun = (cx, cy, r, ray = true) => {
    const rays = ray ? Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const long = i % 2 === 0;
      const r0 = r + (long ? 5 : 3.5);
      const r1 = r + (long ? 14 : 9);
      const x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0;
      const x1 = cx + Math.cos(a) * r1, y1 = cy + Math.sin(a) * r1;
      return `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"
        stroke="url(#${uid}sg)" stroke-width="${long ? 2.4 : 1.7}" stroke-linecap="round"/>`;
    }).join("") : "";
    return `<defs>
      <radialGradient id="${uid}sc" cx="38%" cy="35%" r="65%">
        <stop offset="0%" stop-color="#ffe9a0"/><stop offset="55%" stop-color="#f2a93b"/><stop offset="100%" stop-color="#e07820"/>
      </radialGradient>
      <linearGradient id="${uid}sg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ffd56a"/><stop offset="100%" stop-color="#f08a3c"/>
      </linearGradient>
    </defs>
    ${rays}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${uid}sc)"/>
    <circle cx="${cx - r * 0.28}" cy="${cy - r * 0.28}" r="${r * 0.28}" fill="#fff6d0" opacity=".45"/>`;
  };
  const cloud = (fill, stroke, ox = 0, oy = 0) => `
    <g transform="translate(${ox} ${oy})">
      <path d="M14 40h30a9 9 0 0 0 1.2-17.9 12 12 0 0 0-22.4-3.2A8.5 8.5 0 0 0 14 40z"
        fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
      <ellipse cx="28" cy="34" rx="14" ry="5" fill="#fff" opacity=".07"/>
    </g>`;
  const drops = (n, dark = false) => Array.from({ length: n }, (_, i) => {
    const x = 20 + i * (24 / Math.max(1, n - 1));
    return `<path d="M${x} 46c0 0-2.2 3.2-2.2 5a2.2 2.2 0 1 0 4.4 0c0-1.8-2.2-5-2.2-5z"
      fill="${dark ? "#4a8fe8" : "#6eb0ff"}"/>`;
  }).join("");
  const bolt = `<path d="M34 42l-5 8h4l-2 8 8-11h-4l3-5z" fill="#f2d03b" stroke="#f08a3c" stroke-width=".6"/>`;

  let body = "";
  switch (w) {
    case 0: body = sun(32, 32, 12); break;
    case 1: body = sun(42, 20, 8) + cloud("#c5ccd6", "#9ba1a9", 0, 4); break;
    case 2: body = cloud("#9ba1a9", "#6e7480", 2, -2) + cloud("#b6bec8", "#8a919b", -2, 6); break;
    case 3: body = cloud("#aeb6c0", "#7e8692") + drops(3); break;
    case 4: body = cloud("#7a8492", "#555e6a") + drops(5, true); break;
    case 5: body = cloud("#5a6472", "#3b414a") + drops(4, true) + bolt; break;
    default: body = sun(32, 32, 12);
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

function gauge(label, value, unit, max, color) {
  const pct = Math.max(0, Math.min(100, (Number(value) / max) * 100));
  const r = 22, c = 2 * Math.PI * r, dash = (pct / 100) * c;
  return `<div class="wx-gauge">
    <svg viewBox="0 0 56 56" width="56" height="56" aria-hidden="true">
      <circle cx="28" cy="28" r="${r}" fill="none" stroke="var(--line)" stroke-width="5"/>
      <circle cx="28" cy="28" r="${r}" fill="none" stroke="${color}" stroke-width="5"
        stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}"
        transform="rotate(-90 28 28)"/>
      <text x="28" y="31" text-anchor="middle" fill="var(--chalk)" font-size="12" font-family="var(--num)" font-weight="700">${value ?? "–"}${unit}</text>
    </svg>
    <span>${escapeHtml(label)}</span>
  </div>`;
}

function render() {
  const s = doc.session || {};
  const f = forecastForSession();
  const now = f[0];
  const rainNow = now?.rain ?? s.rainNow ?? 0;
  const name = WEATHER[s.weather] || "–";
  $("session").textContent = [s.track, s.type].filter(Boolean).join(" · ");

  const rainy = f.some((x) => x.rain > 30 || x.weather >= 3);
  const acc = slow?.forecastAccurate;
  $("wx-brief").innerHTML = `
    <div class="wx-brief-top">
      <div class="wx-brief-hero">
        ${weatherIcon(s.weather, 72)}
        <div>
          <b class="wx-big">${escapeHtml(name)}</b>
          <p class="dv-muted">Forecast accuracy: <em class="${acc ? "wx-ok" : ""}">${acc ? "Perfect" : "Approximate"}</em></p>
        </div>
      </div>
      <div class="wx-brief-mini">${f.slice(0, 3).map((x) =>
        `<div>
          <span>+${x.offset === 0 ? "now" : x.offset + "m"}</span>
          ${weatherIcon(x.weather, 36)}
          <em>${x.rain}%</em>
          <small>${x.trackTemp}°</small>
        </div>`).join("") || "<span class='dv-muted'>No samples</span>"}</div>
    </div>
    <p class="wx-brief-sum">${rainy
      ? "Rain expected — keep intermediates ready."
      : "Dry conditions — standard dry tyre strategy."}</p>`;

  const opts = tyreOpts();
  const dry = opts.dry, inter = opts.inter, wet = opts.wet;
  const fastest = [dry, inter, wet].filter(Boolean).sort((a, b) => a.lapDeltaMs - b.lapDeltaMs)[0];
  const fitted = (slow?.tyreSets || []).find((t) => t.fitted);
  $("wx-rec").innerHTML = fastest
    ? `<div class="wx-rec-head">
         <span class="tt-tyre-pill wx-rec-pill" style="--c:${COMPOUND[fastest.visual] || "var(--line)"}">${LETTER[fastest.visual] || "?"}</span>
         <div>
           <b class="wx-huge">${escapeHtml(fastest.actual || fastest.visual)}</b>
           <p class="dv-muted">${fitted?.fitted && fitted === fastest ? "Currently fitted · fastest" : fastest.fitted ? "Currently fitted" : `Fastest available · ${escapeHtml(fastest.actual || fastest.visual)}`}</p>
         </div>
       </div>
       <div class="wx-rec-rows">${[["Dry", dry], ["Inter", inter], ["Wet", wet]].map(([lab, t]) => t
         ? `<div><span class="tt-tyre-pill" style="--c:${COMPOUND[t.visual] || "var(--line)"}">${LETTER[t.visual] || lab[0]}</span>
              <span>${escapeHtml(t.actual || t.visual)}</span>
              <em>${t === fastest ? "fastest" : fmtDelta(t.lapDeltaMs)}</em></div>`
         : `<div class="dv-muted">${lab}: no set</div>`).join("")}</div>`
    : `<p class="dv-muted">Tyre set data is only sent for your own car.</p>`;

  const left = s.timeLeft != null ? `${Math.floor(s.timeLeft / 60)}:${String(s.timeLeft % 60).padStart(2, "0")}` : "–";
  const trackDry = rainNow < 15 && (s.weather ?? 0) < 3;
  $("wx-sum").innerHTML = `
    <div class="wx-sum-hero">
      ${weatherIcon(s.weather, 56)}
      <div>
        <b class="wx-big">${escapeHtml(name)}</b>
        <p class="dv-muted">Time left <strong>${left}</strong></p>
        <p><span class="wx-pill ${acc ? "good" : ""}">${acc ? "PERFECT" : "APPROX"}</span>
           <span class="wx-pill ${trackDry ? "good" : "warn"}">${trackDry ? "TRACK DRY" : "TRACK WET"}</span></p>
      </div>
    </div>
    <div class="wx-gauges">
      ${gauge("Track", s.trackTemp, "°", 60, "var(--hot)")}
      ${gauge("Air", s.airTemp, "°", 50, "var(--medium)")}
      ${gauge("Rain", rainNow, "%", 100, "var(--cold)")}
    </div>`;

  $("wx-radar").innerHTML = f.length
    ? `<div class="wx-radar-row">${f.slice(0, 12).map((x) =>
      `<div class="wx-radar-cell">
        <span>${x.offset === 0 ? "Now" : `+${x.offset}m`}</span>
        ${weatherIcon(x.weather, 32)}
        <b>${x.rain}%</b>
      </div>`).join("")}</div>`
    : `<p class="dv-muted">No radar samples yet.</p>`;

  const per = rainChangePerMin();
  const trend = per == null ? "–" : Math.abs(per) < 0.3 ? "STABLE" : per > 0 ? "RISING" : "FALLING";
  $("wx-rain").innerHTML = `
    <p class="wx-kicker">Rain now</p>
    <b class="wx-huge wx-rain-val">${rainNow}%</b>
    <dl class="wx-rain-meta">
      <div><dt>Change / min</dt><dd>${per == null ? "–" : `${per >= 0 ? "+" : ""}${per.toFixed(1)}%/min`}</dd></div>
      <div><dt>Trend</dt><dd><span class="wx-pill ${trend === "STABLE" ? "good" : trend === "RISING" ? "warn" : ""}">${trend}</span></dd></div>
    </dl>`;

  renderPrediction(f);
  const risk = rainy ? (f.some((x) => x.rain > 50) ? "HIGH" : "MED") : "LOW";
  $("wx-strat").innerHTML = `
    <b class="wx-huge ${rainy ? "wx-warn" : "wx-ok"}">${rainy ? "WEATHER CHANGE" : "CONDITIONS STABLE"}</b>
    <p><span class="wx-pill ${risk === "LOW" ? "good" : risk === "MED" ? "warn" : "bad"}">${risk} RISK</span></p>
    <p class="dv-muted">${rainy
      ? "Watch the radar and prepare inters/wets."
      : `Dry conditions, ${rainNow}% rain. No weather changes expected.`}</p>
    <div class="wx-comp-row">${["Soft", "Medium", "Hard", "Inter", "Wet"].map((c) =>
      `<span class="tt-tyre-pill" style="--c:${COMPOUND[c]}" title="${c}">${LETTER[c]}</span>`).join("")}</div>`;

  $("wx-timeline").innerHTML = f.length
    ? `<div class="wx-time-row">${f.slice(0, 8).map((x, i) =>
      `<div class="wx-time-cell">
        <span>${i === 0 ? "NOW" : `+${x.offset}M`}</span>
        ${weatherIcon(x.weather, 40)}
        <b>${x.rain}%</b>
        <small>${x.trackTemp}° / ${x.airTemp}°</small>
      </div>`).join("")}</div>`
    : `<p class="dv-muted">No timeline yet.</p>`;

  const kindLabel = { dry: "DRY", inter: "INT", wet: "WET" };
  const scores = [
    { k: "dry", t: dry, score: dry ? Math.max(0, 100 - Math.abs(dry.lapDeltaMs) / 50) : 0 },
    { k: "inter", t: inter, score: inter ? Math.max(0, 100 - Math.abs(inter.lapDeltaMs) / 50) : (rainNow > 20 ? 40 : 10) },
    { k: "wet", t: wet, score: wet ? Math.max(0, 100 - Math.abs(wet.lapDeltaMs) / 50) : (rainNow > 50 ? 50 : 5) },
  ];
  if (rainNow < 15) scores[0].score = Math.max(scores[0].score, 90);
  const top = [...scores].sort((a, b) => b.score - a.score)[0];
  $("wx-best").innerHTML = `
    <p class="dv-muted">Recommended</p>
    <b class="wx-huge">${kindLabel[top.k]}</b>
    <div class="wx-bars">${scores.map((x) =>
      `<div><span>${kindLabel[x.k]}</span><i><b style="width:${Math.min(100, x.score)}%"></b></i></div>`).join("")}</div>`;

  const focus = doc.focus;
  if (!focus) {
    $("wx-temps").innerHTML = `<p class="dv-muted">No car telemetry yet.</p>`;
  } else {
    const temps = WHEELS.map(({ i }) => focus.tyreInner?.[i] ?? 0);
    const avg = (a, b) => ((temps[a] + temps[b]) / 2).toFixed(0);
    // Big number = tyre core (UDP inner) — top MFD reading in-game.
    $("wx-temps").innerHTML = `
      <div class="wx-tyre-map">
        ${WHEELS.map(({ i, label }) => {
          const core = focus.tyreInner?.[i] ?? 0;
          const surf = focus.tyreSurface?.[i] ?? 0;
          const press = focus.tyrePressure?.[i];
          const wear = focus.tyreWear?.[i] ?? 0;
          const cls = core < 70 ? "cold" : core > 105 ? "hot" : "ok";
          return `<div class="wx-tyre ${cls}">
            <span class="wx-tyre-pos">${label}</span>
            <b>${core}°C</b>
            <small>Surface ${surf}°C</small>
            <small>${press != null ? `${press.toFixed(1)} PSI` : "–"}</small>
            <small>Wear ${wear.toFixed(1)}%</small>
          </div>`;
        }).join("")}
        <div class="wx-tyre-mid">
          <em class="tt-tyre-pill" style="--c:${COMPOUND[focus.compound] || "var(--line)"}">${escapeHtml(focus.compound || "–")}</em>
          <span class="dv-muted">Age ${focus.tyreAge ?? 0} laps</span>
        </div>
      </div>
      <p class="wx-balance">Balance:
        Front avg <b>${avg(0, 1)}°C</b> ·
        Rear avg <b>${avg(2, 3)}°C</b> ·
        Left avg <b>${avg(0, 2)}°C</b> ·
        Right avg <b>${avg(1, 3)}°C</b>
      </p>`;
  }
}

function renderPrediction(f) {
  if (!f.length) {
    $("wx-pred").innerHTML = `<p class="dv-muted">Waiting for forecast samples.</p>`;
    return;
  }
  const W = 920, H = 200, padL = 40, padR = 16, padT = 28, padB = 28;
  const maxOff = Math.max(1, ...f.map((x) => x.offset));
  const maxT = Math.max(25, ...f.map((x) => Math.max(x.trackTemp, x.airTemp)) + 2);
  const minT = Math.min(15, ...f.map((x) => Math.min(x.trackTemp, x.airTemp)) - 2);
  const X = (o) => padL + (o / maxOff) * (W - padL - padR);
  const Yt = (t) => padT + (1 - (t - minT) / (maxT - minT || 1)) * (H - padT - padB);
  const Yr = (r) => padT + (1 - r / 100) * (H - padT - padB);
  const grid = [];
  for (let t = Math.ceil(minT / 5) * 5; t <= maxT; t += 5) {
    const y = Yt(t);
    grid.push(`<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--line)" stroke-width="1"/>`);
    grid.push(`<text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="var(--dim)" font-size="11">${t}°</text>`);
  }
  const poly = (pts, stroke, width = 2.5) => pts.length
    ? `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>` : "";
  const rainBars = f.map((x) => {
    const x0 = X(x.offset);
    const y0 = Yr(0), y1 = Yr(x.rain);
    const h = Math.max(0, y0 - y1);
    return `<rect x="${x0 - 4}" y="${y1}" width="8" height="${h}" rx="2" fill="var(--cold)" opacity=".35"/>`;
  }).join("");
  $("wx-pred").innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="wx-chart" role="img" aria-label="Rain and temperature forecast">
    ${grid.join("")}
    ${rainBars}
    ${poly(f.map((x) => [X(x.offset), Yt(x.trackTemp)]), "var(--hot)", 2.8)}
    ${poly(f.map((x) => [X(x.offset), Yt(x.airTemp)]), "var(--medium)", 2.4)}
    ${poly(f.map((x) => [X(x.offset), Yr(x.rain)]), "var(--cold)", 2)}
    <g font-size="12" font-family="var(--text)">
      <circle cx="48" cy="14" r="4" fill="var(--hot)"/><text x="56" y="18" fill="var(--dim)">Track temp</text>
      <circle cx="150" cy="14" r="4" fill="var(--medium)"/><text x="158" y="18" fill="var(--dim)">Air temp</text>
      <circle cx="248" cy="14" r="4" fill="var(--cold)"/><text x="256" y="18" fill="var(--dim)">Rain %</text>
    </g>
  </svg>`;
}
