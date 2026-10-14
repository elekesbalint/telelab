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

function weatherIcon(w, size = 28) {
  const sun = `<circle cx="12" cy="12" r="5" fill="var(--medium)"/>`;
  const cloud = (fill) => `<path d="M7 18h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.4A3.3 3.3 0 0 0 7 18z" fill="${fill}"/>`;
  const drops = (n) => Array.from({ length: n }, (_, i) => `<line x1="${8 + i * 4}" y1="20" x2="${7 + i * 4}" y2="23" stroke="var(--wet)" stroke-width="1.6" stroke-linecap="round"/>`).join("");
  const body = [sun, sun + cloud("var(--dim)"), cloud("var(--dim)"), cloud("var(--dim)") + drops(2),
    cloud("var(--line)") + drops(3), cloud("var(--line)") + drops(3)][w] || sun;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
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
      ${weatherIcon(s.weather, 48)}
      <div>
        <b class="wx-big">${escapeHtml(name)}</b>
        <p class="dv-muted">Forecast accuracy: ${acc ? "Perfect" : "Approximate"}</p>
      </div>
      <div class="wx-brief-mini">${f.slice(0, 3).map((x) =>
        `<div>${weatherIcon(x.weather, 22)}<span>+${x.offset}m</span><em>${x.rain}%</em></div>`).join("") || "<span class='dv-muted'>No samples</span>"}</div>
    </div>
    <p class="wx-brief-sum">${rainy
      ? "Rain expected — keep intermediates ready."
      : "Dry conditions — standard dry tyre strategy."}</p>`;

  const opts = tyreOpts();
  const dry = opts.dry, inter = opts.inter, wet = opts.wet;
  const fastest = [dry, inter, wet].filter(Boolean).sort((a, b) => a.lapDeltaMs - b.lapDeltaMs)[0];
  $("wx-rec").innerHTML = fastest
    ? `<b class="wx-huge">${escapeHtml(fastest.actual || fastest.visual)}</b>
       <p class="dv-muted">${fastest.fitted ? "Currently fitted" : `Currently on fastest (${escapeHtml(fastest.actual || fastest.visual)})`}</p>
       <div class="wx-rec-rows">${[["Dry", dry], ["Inter", inter], ["Wet", wet]].map(([lab, t]) => t
         ? `<div><span class="tt-tyre-pill" style="--c:${COMPOUND[t.visual] || "var(--line)"}">${LETTER[t.visual] || lab[0]}</span> ${escapeHtml(t.actual || t.visual)} <em>${t === fastest ? "fastest" : fmtDelta(t.lapDeltaMs)}</em></div>`
         : `<div class="dv-muted">${lab}: no set</div>`).join("")}</div>`
    : `<p class="dv-muted">Tyre set data is only sent for your own car.</p>`;

  const left = s.timeLeft != null ? `${Math.floor(s.timeLeft / 60)}:${String(s.timeLeft % 60).padStart(2, "0")}` : "–";
  $("wx-sum").innerHTML = `
    <div class="wx-sum-row">${weatherIcon(s.weather, 36)}<b>${escapeHtml(name)}</b></div>
    <dl class="dv-stats">
      <div><dt>Session time left</dt><dd>${left}</dd></div>
      <div><dt>Track</dt><dd>${s.trackTemp ?? "–"} °C</dd></div>
      <div><dt>Air</dt><dd>${s.airTemp ?? "–"} °C</dd></div>
      <div><dt>Rain now</dt><dd>${rainNow}%</dd></div>
    </dl>`;

  $("wx-radar").innerHTML = f.length
    ? `<div class="wx-radar-row">${f.slice(0, 12).map((x) =>
      `<div class="wx-radar-cell"><span>${x.offset === 0 ? "Now" : `+${x.offset}m`}</span>${weatherIcon(x.weather, 20)}<b>${x.rain}%</b></div>`).join("")}</div>`
    : `<p class="dv-muted">No radar samples yet.</p>`;

  const per = rainChangePerMin();
  const trend = per == null ? "–" : Math.abs(per) < 0.3 ? "STABLE" : per > 0 ? "RISING" : "FALLING";
  $("wx-rain").innerHTML = `
    <b class="wx-huge">${rainNow}%</b>
    <p class="dv-muted">${per == null ? "–" : `${per >= 0 ? "+" : ""}${per.toFixed(1)}%/min`}</p>
    <span class="wx-pill ${trend === "STABLE" ? "good" : trend === "RISING" ? "warn" : ""}">${trend}</span>`;

  renderPrediction(f);
  const risk = rainy ? (f.some((x) => x.rain > 50) ? "HIGH" : "MED") : "LOW";
  $("wx-strat").innerHTML = `
    <b class="wx-huge ${rainy ? "warn" : "good"}">${rainy ? "WEATHER CHANGE" : "CONDITIONS STABLE"}</b>
    <p><span class="wx-pill ${risk === "LOW" ? "good" : risk === "MED" ? "warn" : "bad"}">${risk}</span></p>
    <p class="dv-muted">${rainy ? "Watch the radar and prepare inters/wets." : "No weather change expected in this window."}</p>
    <div class="wx-comp-dots">${["Soft","Medium","Hard","Inter","Wet"].map((c) =>
      `<i style="--c:${COMPOUND[c]}"></i>`).join("")}</div>`;

  $("wx-timeline").innerHTML = f.length
    ? `<div class="wx-time-row">${f.slice(0, 8).map((x, i) =>
      `<div class="wx-time-cell"><span>${i === 0 ? "NOW" : `+${x.offset}M`}</span>${weatherIcon(x.weather, 24)}<b>${x.rain}%</b><small>${x.trackTemp}° / ${x.airTemp}°</small></div>`).join("")}</div>`
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
    // Big number = tyre core (UDP inner) — same as the top MFD reading in-game.
    $("wx-temps").innerHTML = `<div class="wx-tyre-grid">${WHEELS.map(({ i, label }) => {
      const core = focus.tyreInner?.[i] ?? 0;
      const surf = focus.tyreSurface?.[i] ?? 0;
      const press = focus.tyrePressure?.[i];
      const wear = focus.tyreWear?.[i] ?? 0;
      const cls = core < 70 ? "cold" : core > 105 ? "hot" : "ok";
      return `<div class="wx-tyre ${cls}">
        <span>${label}</span>
        <b>${core}°C</b>
        <small>${press != null ? `${press.toFixed(1)} PSI` : "–"} · wear ${wear.toFixed(1)}% · surf ${surf}°C</small>
        <em class="tt-tyre-pill" style="--c:${COMPOUND[focus.compound] || "var(--line)"}">${escapeHtml(focus.compound || "–")}</em>
      </div>`;
    }).join("")}</div>`;
  }
}

function renderPrediction(f) {
  if (!f.length) {
    $("wx-pred").innerHTML = `<p class="dv-muted">Waiting for forecast samples.</p>`;
    return;
  }
  const W = 900, H = 170, pad = 28;
  const maxOff = Math.max(1, ...f.map((x) => x.offset));
  const maxT = Math.max(20, ...f.map((x) => Math.max(x.trackTemp, x.airTemp)));
  const minT = Math.min(0, ...f.map((x) => Math.min(x.trackTemp, x.airTemp)));
  const X = (o) => pad + (o / maxOff) * (W - pad - 10);
  const Yt = (t) => H - 18 - ((t - minT) / (maxT - minT || 1)) * (H - 36);
  const Yr = (r) => H - 18 - (r / 100) * (H - 36);
  const poly = (pts, stroke) => pts.length
    ? `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${stroke}" stroke-width="2"/>` : "";
  $("wx-pred").innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="tt-chart" role="img" aria-label="Rain and temperature forecast">
    ${poly(f.map((x) => [X(x.offset), Yt(x.trackTemp)]), "var(--hot)")}
    ${poly(f.map((x) => [X(x.offset), Yt(x.airTemp)]), "var(--medium)")}
    ${poly(f.map((x) => [X(x.offset), Yr(x.rain)]), "var(--cold)")}
    <text x="10" y="14" fill="var(--hot)" font-size="11">Track temp</text>
    <text x="90" y="14" fill="var(--medium)" font-size="11">Air temp</text>
    <text x="160" y="14" fill="var(--cold)" font-size="11">Rain %</text>
  </svg>`;
}
