// Driver Comparison · Inputs: two laps aligned by distance, stacked traces, wheel zoom.
import { initNav, escapeHtml } from "./nav.js";
import { mountFeedPick, preferredFeedPort } from "./feed-pick.js";
import { fmtLap, COMPOUND, COMPOUND_NAME } from "./fmt.js";
import { bindSetupModal } from "./setup.js";

await initNav();
const $ = (id) => document.getElementById(id);
mountFeedPick($("feed-pick"), { preferredPort: preferredFeedPort(null) }).refresh();
bindSetupModal();

const params = new URLSearchParams(location.search);
const parseRef = (s) => {
  const [sid, lap] = String(s || "").split(":").map(Number);
  return sid && lap ? { sid, lap } : null;
};
let refA = parseRef(params.get("a"));
let refB = parseRef(params.get("b"));
const css = getComputedStyle(document.documentElement);
const col = (v) => css.getPropertyValue(v).trim();
const COLOR_A = col("--cold") || "#7FD4FF";
const COLOR_B = col("--purple") || "#B48CFF";
const COLOR_BRK = col("--brk") || "#FF5A5F";
const WHEEL = [
  { k: "RL", c: "#FF5A5F" },
  { k: "RR", c: "#FF8A3D" },
  { k: "FL", c: "#6E8BFF" },
  { k: "FR", c: "#7FD4FF" },
];
const ERS_NAME = ["None", "Medium", "Hotlap", "Boost"];
const STEP = 4; // metres between aligned samples
const KEYS = [
  ["t"], ["speed"], ["throttle"], ["brake"], ["gear", true], ["steer"],
  ["ersMJ"], ["rpm"], ["x"], ["z"], ["ersMode", true], ["ersPct"], ["ersChg"],
  ["yawDeg"], ["yawRate"], ["engTemp"], ["bias"], ["aero", true], ["cogMm"],
];

let A = null, B = null, plots = [], al = null, cursorIdx = null, playing = false, playTimer = 0;

const load = async (ref) => {
  if (!ref) return null;
  const [lap, ses] = await Promise.all([
    fetch(`/api/sessions/${ref.sid}/laps/${ref.lap}/telemetry`).then((r) => (r.ok ? r.json() : null)),
    fetch(`/api/sessions/${ref.sid}`).then((r) => (r.ok ? r.json() : null)),
  ]);
  return lap && { ...lap, session: ses, ref };
};

if (refA) A = await load(refA);
if (refB) B = await load(refB);
render();

function setRefs(nextA, nextB) {
  refA = nextA; refB = nextB;
  if (refA) params.set("a", `${refA.sid}:${refA.lap}`); else params.delete("a");
  if (refB) params.set("b", `${refB.sid}:${refB.lap}`); else params.delete("b");
  history.replaceState(null, "", `?${params}`);
}

function tyreName(v) { return COMPOUND_NAME[v] || ""; }
function tyreChip(v) {
  const name = tyreName(v);
  return name ? `<span class="cmp-tyre" style="--c:${COMPOUND[v] || "var(--line)"}">${escapeHtml(name)}</span>` : "";
}

function render() {
  stopPlay();
  paintDrivers();
  for (const p of plots) p.destroy();
  plots = [];
  $("charts").innerHTML = "";
  al = null;
  cursorIdx = null;
  $("tip").hidden = true;
  const tabTiming = $("tab-timing");
  const tabSetup = $("tab-setup");
  if (A?.sessionId) tabTiming.href = `/session.html?id=${A.sessionId}`;
  if (A?.sessionId) {
    tabSetup.dataset.setup = String(A.sessionId);
    tabSetup.dataset.who = A.driver || "";
    tabSetup.dataset.track = A.track || A.session?.track || "";
    tabSetup.dataset.type = A.session?.type || "";
    tabSetup.dataset.lap = String(A.lap || "");
  } else {
    delete tabSetup.dataset.setup;
  }
  if (!A?.dist?.length) {
    $("charts").innerHTML = `<p class="lead">Pick a lap with stored telemetry. Open one from the <a href="/laps.html">Lap Leaderboard</a> or the <a href="/sessions.html">Sessions</a> page.</p>`;
    drawMap(null, null);
    return;
  }
  al = align(A, B?.dist?.length ? B : null);
  charts(al);
  drawMap(al, null);
}

function paintDrivers() {
  const row = (L, n, color, changeable) => {
    if (!L) {
      return `<div class="cmp-drv empty" style="--k:${color}">
        <span class="cmp-who">Driver ${n}</span>
        <span class="cmp-empty">Select lap…</span>
        ${pickerHtml(n)}
      </div>`;
    }
    const s = L.session || {};
    const type = s.type || "";
    const s1 = fmtLap(L.s1Ms), s2 = fmtLap(L.s2Ms), s3 = fmtLap(L.s3Ms);
    return `<div class="cmp-drv" style="--k:${color}">
      <span class="cmp-who">Driver ${n}</span>
      <strong>${escapeHtml(L.driver || s.player || "?")}</strong>
      <span class="cmp-lapmeta">Lap ${L.lap} — ${fmtLap(L.lapTimeMs)} — ${tyreChip(L.tyreVisual)} ${escapeHtml(type ? `(${type})` : "")}</span>
      <span class="cmp-sects"><em>S1</em> ${s1} <em>S2</em> ${s2} <em>S3</em> ${s3}</span>
      ${changeable ? `<button type="button" class="cmp-x" data-clear="${n}" title="Remove overlay">×</button>` : ""}
      ${pickerHtml(n)}
    </div>`;
  };
  $("drivers").innerHTML = row(A, 1, COLOR_A, false) + row(B, 2, COLOR_B, true);
  wirePickers($("drivers"));
  $("drivers").querySelector("[data-clear]")?.addEventListener("click", async () => {
    B = null; setRefs(refA, null); render();
  });
}

function pickerHtml(n) {
  return `<details class="cmp-pick" data-n="${n}"><summary>Change lap</summary>
    <label>Session <select class="p-ses"><option>Loading…</option></select></label>
    <label>Lap <select class="p-lap"></select></label>
    <button type="button" class="primary p-go">Load</button></details>`;
}

function wirePickers(root) {
  for (const det of root.querySelectorAll("details.cmp-pick")) {
    det.addEventListener("toggle", async () => {
      if (!det.open || det.dataset.ready) return;
      det.dataset.ready = "1";
      const track = A?.session?.trackId;
      const q = track != null && track >= 0 ? `&track=${track}` : "";
      const list = await (await fetch(`/api/sessions?limit=200${q}`)).json();
      const sesSel = det.querySelector(".p-ses"), lapSel = det.querySelector(".p-lap");
      sesSel.innerHTML = (list || []).filter((s) => s.hasSamples).map((s) =>
        `<option value="${s.id}">${escapeHtml(s.player)}, ${escapeHtml(s.type)}, ${escapeHtml(s.track)} (best ${fmtLap(s.bestLapMs)})</option>`).join("")
        || `<option value="">No sessions with telemetry</option>`;
      const fillLaps = async () => {
        if (!sesSel.value) { lapSel.innerHTML = ""; return; }
        const laps = ((await (await fetch(`/api/sessions/${sesSel.value}/laps`)).json()) || []).filter((l) => l.isPlayer);
        lapSel.innerHTML = laps.sort((a, b) => a.lapTimeMs - b.lapTimeMs)
          .map((l) => `<option value="${l.lapNum}">Lap ${l.lapNum}, ${fmtLap(l.lapTimeMs)}${l.valid ? "" : " (invalid)"}</option>`).join("");
      };
      sesSel.addEventListener("change", fillLaps);
      if (sesSel.value) await fillLaps();
      det.querySelector(".p-go").addEventListener("click", async () => {
        const ref = { sid: Number(sesSel.value), lap: Number(lapSel.value) };
        if (!ref.sid || !ref.lap) return;
        const n = Number(det.dataset.n);
        const packed = await load(ref);
        if (!packed?.dist?.length) { alert("That lap has no telemetry."); return; }
        if (n === 1 || !A) { A = packed; setRefs(ref, n === 1 ? refB : null); }
        else { B = packed; setRefs(refA, ref); }
        render();
      });
    });
  }
}

function interp(xs, ys, x, step) {
  let lo = 0, hi = xs.length - 1;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[hi]) return ys[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  if (step) return ys[lo];
  const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + (ys[hi] - ys[lo]) * f;
}

function monotonic(L) {
  const keep = [];
  let last = -Infinity;
  L.dist.forEach((d, i) => { if (d > last) { keep.push(i); last = d; } });
  const pick = (arr) => (arr && arr.length ? keep.map((i) => arr[i]) : null);
  const wheels = (arr) => (Array.isArray(arr) && arr.length ? arr.map(pick) : null);
  const out = { dist: pick(L.dist) };
  for (const [key] of KEYS) out[key] = pick(L[key]);
  out.brakeTemp = wheels(L.brakeTemp);
  out.tSurf = wheels(L.tSurf);
  out.tInner = wheels(L.tInner);
  out.wear = wheels(L.wear);
  return out;
}

function align(LA, LB) {
  const a = monotonic(LA), b = LB ? monotonic(LB) : null;
  const end = Math.min(a.dist.at(-1), b ? b.dist.at(-1) : Infinity);
  const d = [];
  for (let x = 0; x <= end; x += STEP) d.push(x);
  const ch = (L, key, step) => {
    if (!L?.[key] || L[key].length < 2) return null;
    if (key === "x" || key === "z") {
      const keep = L.x.map((v, i) => v !== 0 || L.z[i] !== 0);
      const ds = L.dist.filter((_, i) => keep[i]), vs = L[key].filter((_, i) => keep[i]);
      return ds.length ? d.map((x) => interp(ds, vs, x, false)) : d.map(() => 0);
    }
    return d.map((x) => interp(L.dist, L[key], x, step));
  };
  const wheels = (L, key) => {
    if (!L?.[key]) return null;
    const out = [];
    for (let w = 0; w < 4; w++) {
      if (!L[key][w] || L[key][w].length < 2) return null;
      out.push(d.map((x) => interp(L.dist, L[key][w], x, false)));
    }
    return out;
  };
  const out = { d, a: {}, b: b ? {} : null, sectors: sectorXs(a, LA) };
  for (const [key, step] of KEYS) {
    out.a[key] = ch(a, key, step);
    if (b) out.b[key] = ch(b, key, step);
  }
  out.a.brakeTemp = wheels(a, "brakeTemp");
  out.a.tSurf = wheels(a, "tSurf");
  out.a.tInner = wheels(a, "tInner");
  out.a.wear = wheels(a, "wear");
  if (b) {
    out.b.brakeTemp = wheels(b, "brakeTemp");
    out.b.tSurf = wheels(b, "tSurf");
    out.b.tInner = wheels(b, "tInner");
    out.b.wear = wheels(b, "wear");
  }
  out.delta = b && out.a.t && out.b.t ? d.map((_, i) => (out.b.t[i] - out.a.t[i]) / 1000) : null;
  return out;
}

function sectorXs(mono, L) {
  const xs = [];
  const t1 = L.s1Ms, t2 = (L.s1Ms || 0) + (L.s2Ms || 0);
  const find = (ms, lab) => {
    if (!ms || !mono.t) return;
    const i = mono.t.findIndex((t) => t >= ms);
    if (i >= 0) xs.push({ x: mono.dist[i], lab });
  };
  find(t1, "S1");
  find(t2, "S2");
  return xs;
}

function present(arr) {
  return Array.isArray(arr) && arr.length > 4;
}
function live(arr) {
  return present(arr) && arr.some((v) => Number.isFinite(Number(v)) && Number(v) !== 0);
}
function liveAero(arr) {
  return present(arr) && arr.some((v) => Number(v) >= 0);
}

function charts(al) {
  const host = $("charts");
  const sync = uPlot.sync("cmp");
  const pct = (src) => src && src.map((v) => v * 100);
  const deg = (src) => src && src.map((v) => v * 180);
  const defs = [
    {
      title: "Throttle & brake (%)", h: 150, range: [0, 100],
      series: [
        live(al.a.throttle) && { label: "Thr 1", stroke: COLOR_A, fill: "rgba(127,212,255,.16)", data: pct(al.a.throttle) },
        live(al.a.brake) && { label: "Brk 1", stroke: COLOR_BRK, data: pct(al.a.brake) },
        live(al.b?.throttle) && { label: "Thr 2", stroke: COLOR_B, data: pct(al.b.throttle) },
        live(al.b?.brake) && { label: "Brk 2", stroke: "#ff8a8d", data: pct(al.b.brake) },
      ].filter(Boolean),
    },
    {
      title: "Steering (°)", h: 110,
      series: [
        live(al.a.steer) && { label: "1", stroke: COLOR_A, data: deg(al.a.steer) },
        live(al.b?.steer) && { label: "2", stroke: COLOR_B, data: deg(al.b.steer) },
      ].filter(Boolean),
    },
    live(al.a.yawRate) && {
      title: "Yaw rate (°/s)", h: 110,
      series: [
        { label: "1", stroke: COLOR_A, data: al.a.yawRate },
        live(al.b?.yawRate) && { label: "2", stroke: COLOR_B, data: al.b.yawRate },
      ].filter(Boolean),
    },
    {
      title: "Speed (km/h)", h: 140,
      series: [
        live(al.a.speed) && { label: "1", stroke: COLOR_A, data: al.a.speed },
        live(al.b?.speed) && { label: "2", stroke: COLOR_B, data: al.b.speed },
      ].filter(Boolean),
    },
    live(al.a.cogMm) && {
      title: "Bottoming (mm)", h: 120, range: cogRange(al),
      series: [
        { label: "1", stroke: COLOR_A, data: al.a.cogMm },
        live(al.b?.cogMm) && { label: "2", stroke: COLOR_B, data: al.b.cogMm },
      ].filter(Boolean),
      hits: al.a.cogMm,
    },
    {
      title: "Gears", h: 100, stepped: true, incrs: [1],
      series: [
        live(al.a.gear) && { label: "1", stroke: COLOR_A, data: al.a.gear },
        live(al.b?.gear) && { label: "2", stroke: COLOR_B, data: al.b.gear },
      ].filter(Boolean),
    },
    present(al.a.ersMode) && {
      title: "ERS mode", h: 100, stepped: true, range: [-0.2, 3.2], incrs: [1],
      axis: (v) => ERS_NAME[v] || String(v),
      series: [
        { label: "1", stroke: COLOR_A, data: al.a.ersMode },
        live(al.b?.ersMode) && { label: "2", stroke: COLOR_B, data: al.b.ersMode },
      ].filter(Boolean),
    },
    live(al.a.ersPct) && {
      title: "ERS level (%)", h: 110, range: [0, 100],
      series: [
        { label: "1", stroke: COLOR_A, data: al.a.ersPct },
        live(al.b?.ersPct) && { label: "2", stroke: COLOR_B, data: al.b.ersPct },
      ].filter(Boolean),
    },
    live(al.a.ersChg) && {
      title: "ERS recharged this lap (%)", h: 110, range: [0, 100],
      series: [
        { label: "1", stroke: COLOR_A, data: al.a.ersChg },
        live(al.b?.ersChg) && { label: "2", stroke: COLOR_B, data: al.b.ersChg },
      ].filter(Boolean),
    },
    wheelDef("Tyre inner (°C)", al.a.tInner, al.b?.tInner),
    wheelDef("Tyre surface (°C)", al.a.tSurf, al.b?.tSurf),
    wheelDef("Tyre wear (%)", al.a.wear, al.b?.wear, true),
    wheelDef("Brake temp (°C)", al.a.brakeTemp, al.b?.brakeTemp),
    live(al.a.engTemp) && {
      title: "Engine temp (°C)", h: 90,
      series: [
        { label: "1", stroke: COLOR_A, data: al.a.engTemp },
        live(al.b?.engTemp) && { label: "2", stroke: COLOR_B, data: al.b.engTemp },
      ].filter(Boolean),
    },
    liveAero(al.a.aero) && {
      title: "Active aero (straight mode)", h: 90, stepped: true, range: [-0.15, 1.15], incrs: [1],
      axis: (v) => (v >= 0.5 ? "straight" : "corner"),
      series: [
        { label: "1", stroke: COLOR_A, data: al.a.aero.map((v) => (v < 0 ? 0 : v)) },
        liveAero(al.b?.aero) && { label: "2", stroke: COLOR_B, data: al.b.aero.map((v) => (v < 0 ? 0 : v)) },
      ].filter(Boolean),
    },
    live(al.a.bias) && {
      title: "Front brake bias (%)", h: 80,
      series: [
        { label: "1", stroke: COLOR_A, data: al.a.bias },
        live(al.b?.bias) && { label: "2", stroke: COLOR_B, data: al.b.bias },
      ].filter(Boolean),
    },
    {
      title: "Engine RPM", h: 110,
      series: [
        live(al.a.rpm) && { label: "1", stroke: COLOR_A, data: al.a.rpm },
        live(al.b?.rpm) && { label: "2", stroke: COLOR_B, data: al.b.rpm },
      ].filter(Boolean),
    },
  ].filter((d) => d && d.series?.length);

  defs.forEach((def) => {
    const box = document.createElement("section");
    box.className = "cmp-chart";
    box.innerHTML = `<h3>${def.title}${wheelLegend(def)}${def.hits ? bottomHint(def.hits) : ""}</h3><div class="plot"></div>`;
    host.append(box);
    const series = [{}];
    const data = [al.d];
    const path = def.stepped ? uPlot.paths.stepped({ align: 1 }) : undefined;
    for (const s of def.series) {
      series.push({
        label: s.label, stroke: s.stroke, width: s.dash ? 1.2 : 1.5,
        fill: s.fill, dash: s.dash, paths: path, points: { show: false },
      });
      data.push(s.data);
    }
    const plotEl = box.querySelector(".plot");
    const u = new uPlot({
      width: plotEl.clientWidth || 640, height: def.h,
      legend: { show: false },
      cursor: {
        y: false,
        sync: { key: sync.key, setSeries: false, scales: ["x", null] },
        drag: { x: true, y: false },
        points: { size: 7 },
        focus: { prox: 24 },
      },
      scales: { x: { time: false }, y: def.range ? { range: def.range } : {} },
      axes: [
        {
          stroke: col("--dim"), grid: { stroke: "rgba(255,255,255,.06)", width: 1 },
          values: (_u, v) => v.map((m) => `${Math.round(m)}m`), size: 28, font: "11px " + col("--num"),
        },
        {
          stroke: col("--dim"), grid: { stroke: "rgba(255,255,255,.06)", width: 1 },
          size: 52, incrs: def.incrs, font: "11px " + col("--num"),
          values: (_u, v) => v.map(def.axis || ((x) => String(Math.round(x * 100) / 100))),
        },
      ],
      series,
      hooks: {
        setCursor: [(u) => {
          const i = u.cursor.idx;
          if (i == null) { hideTip(); return; }
          cursorIdx = i;
          showTip(al, i, u);
          drawMap(al, i);
        }],
        ready: [(u) => {
          u.over.addEventListener("wheel", (e) => onWheel(u, e), { passive: false });
          u.over.addEventListener("dblclick", () => resetZoom());
        }],
        draw: [(u) => drawSectors(u, al.sectors, def.hits)],
      },
    }, data, plotEl);
    sync.sub(u);
    plots.push(u);
    new ResizeObserver(() => u.setSize({ width: plotEl.clientWidth, height: def.h })).observe(plotEl);
  });
}

function wheelDef(title, aW, bW, stepped) {
  if (!aW) return null;
  const series = [];
  for (let w = 0; w < 4; w++) {
    series.push({ label: WHEEL[w].k, stroke: WHEEL[w].c, data: aW[w] });
    if (bW?.[w]) series.push({ label: WHEEL[w].k + " 2", stroke: WHEEL[w].c, dash: [5, 3], data: bW[w] });
  }
  return { title, h: 120, series, stepped, wheels: true };
}
function wheelLegend(def) {
  if (!def.wheels) return "";
  return `<span class="cmp-wleg">${WHEEL.map((w) => `<i style="background:${w.c}"></i>${w.k}`).join("")}</span>`;
}
function bottomHint(cog) {
  let hits = 0, lowest = Infinity, on = false;
  for (const v of cog) {
    if (v < lowest) lowest = v;
    const touch = v < 3;
    if (touch && !on) hits++;
    on = touch;
  }
  if (!Number.isFinite(lowest)) return "";
  return `<span class="cmp-hint">${hits} hits · lowest ${lowest.toFixed(1)} mm · touching within 3 mm</span>`;
}
function cogRange(al) {
  const xs = [...(al.a.cogMm || []), ...(al.b?.cogMm || [])].filter((v) => Number.isFinite(v));
  if (!xs.length) return [0, 20];
  const lo = Math.min(0, Math.min(...xs) - 1);
  const hi = Math.max(8, Math.max(...xs) + 2);
  return [lo, hi];
}

function drawSectors(u, sectors, hits) {
  const ctx = u.ctx;
  ctx.save();
  if (hits) {
    ctx.fillStyle = "rgba(255,210,63,.18)";
    let run = null;
    for (let i = 0; i < hits.length; i++) {
      if (hits[i] < 3) { if (run == null) run = i; }
      else if (run != null) { fillBand(u, al.d[run], al.d[i]); run = null; }
    }
    if (run != null) fillBand(u, al.d[run], al.d.at(-1));
  }
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(255,255,255,.22)";
  ctx.fillStyle = col("--dim");
  ctx.font = "10px " + (col("--num") || "sans-serif");
  for (const s of sectors || []) {
    const x = u.valToPos(s.x, "x", true);
    ctx.beginPath(); ctx.moveTo(x, u.bbox.top); ctx.lineTo(x, u.bbox.top + u.bbox.height); ctx.stroke();
    ctx.fillText(s.lab, x + 4, u.bbox.top + 12);
  }
  ctx.restore();
}
function fillBand(u, x0, x1) {
  const a = u.valToPos(x0, "x", true), b = u.valToPos(x1, "x", true);
  u.ctx.fillRect(a, u.bbox.top, Math.max(1, b - a), u.bbox.height);
}

function onWheel(u, e) {
  e.preventDefault();
  const rect = u.over.getBoundingClientRect();
  const xVal = u.posToVal(e.clientX - rect.left, "x");
  const sc = u.scales.x;
  const range = sc.max - sc.min;
  const full0 = al.d[0], full1 = al.d.at(-1), full = full1 - full0;
  const factor = e.deltaY < 0 ? 0.82 : 1.22;
  let nRange = Math.max(full * 0.02, Math.min(full, range * factor));
  let nmin = xVal - ((xVal - sc.min) / range) * nRange;
  let nmax = nmin + nRange;
  if (nmin < full0) { nmin = full0; nmax = nmin + nRange; }
  if (nmax > full1) { nmax = full1; nmin = nmax - nRange; }
  plots.forEach((p) => p.setScale("x", { min: nmin, max: nmax }));
}
function resetZoom() {
  if (!al) return;
  plots.forEach((p) => p.setScale("x", { min: al.d[0], max: al.d.at(-1) }));
}

function showTip(al, i, u) {
  const tip = $("tip");
  const L = (src) => src || {};
  const a = L(al.a), b = al.b ? L(al.b) : null;
  const line = (src, name) => {
    if (!src.speed) return "";
    const thr = Math.round((src.throttle?.[i] ?? 0) * 100);
    const brk = Math.round((src.brake?.[i] ?? 0) * 100);
    const st = Math.round((src.steer?.[i] ?? 0) * 180);
    const mode = ERS_NAME[Math.round(src.ersMode?.[i] ?? 0)] || "None";
    const g = Math.round(src.gear?.[i] ?? 0);
    const spd = Math.round(src.speed[i] ?? 0);
    const mm = src.cogMm ? `${src.cogMm[i].toFixed(1)} mm` : "";
    return `<div><b>${escapeHtml(name)}</b> ${spd} km/h · ${thr}% thr · ${brk}% brk · S ${st > 0 ? "+" : ""}${st}° · ${escapeHtml(mode)} · G ${g}${mm ? ` · ${mm}` : ""}</div>`;
  };
  const nameA = A.driver || "Driver 1";
  const nameB = B?.driver || "Driver 2";
  tip.innerHTML = `<div>Distance: ${Math.round(al.d[i])} m</div>${line(a, nameA)}${b ? line(b, nameB) : ""}`;
  tip.hidden = false;
  const over = u.over.getBoundingClientRect();
  const left = over.left + (u.cursor.left || 0) + 14;
  const top = over.top + Math.min(u.cursor.top || 0, over.height - 40);
  tip.style.left = `${Math.min(left, window.innerWidth - 360)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}
function hideTip() { $("tip").hidden = true; }

function drawMap(al, idx) {
  const cv = $("map");
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight || 280;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!al?.a?.x) return;
  const ok = al.a.x.map((x, i) => x !== 0 || al.a.z[i] !== 0);
  const xs = al.a.x, zs = al.a.z;
  if (!ok.some(Boolean)) {
    ctx.fillStyle = col("--dim"); ctx.font = "13px sans-serif"; ctx.fillText("No position data", 12, 24); return;
  }
  const vx = xs.filter((_, i) => ok[i]), vz = zs.filter((_, i) => ok[i]);
  const minX = Math.min(...vx), maxX = Math.max(...vx), minZ = Math.min(...vz), maxZ = Math.max(...vz);
  const pad = 18, s = Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxZ - minZ || 1));
  const ox = (w - (maxX - minX) * s) / 2, oz = (h - (maxZ - minZ) * s) / 2;
  const P = (i) => [ox + (xs[i] - minX) * s, h - (oz + (zs[i] - minZ) * s)];
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.lineWidth = 3; ctx.strokeStyle = COLOR_A;
  ctx.beginPath();
  let pen = false;
  xs.forEach((_, i) => { if (!ok[i]) { pen = false; return; } const [x, y] = P(i); pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; });
  ctx.stroke();
  const first = ok.indexOf(true);
  const [sx, sy] = P(first);
  ctx.fillStyle = col("--chalk"); ctx.fillRect(sx - 2, sy - 6, 4, 12);
  if (idx != null) {
    const dot = (L, color) => {
      if (!L?.x) return;
      const x = ox + (L.x[idx] - minX) * s, y = h - (oz + (L.z[idx] - minZ) * s);
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = col("--asphalt"); ctx.stroke();
    };
    if (al.b) dot(al.b, COLOR_B);
    dot(al.a, COLOR_A);
  }
}

function stopPlay() {
  playing = false;
  clearInterval(playTimer);
  const btn = $("play");
  if (btn) btn.textContent = "▶";
}
function togglePlay() {
  if (!al) return;
  if (playing) { stopPlay(); return; }
  playing = true;
  $("play").textContent = "❚❚";
  let i = cursorIdx || 0;
  playTimer = setInterval(() => {
    i += 4;
    if (i >= al.d.length) i = 0;
    cursorIdx = i;
    const x = al.d[i];
    plots.forEach((p) => {
      const left = p.valToPos(x, "x");
      p.setCursor({ left, top: p.valToPos((p.scales.y.min + p.scales.y.max) / 2, "y") });
    });
    drawMap(al, i);
  }, 40);
}
$("play").addEventListener("click", togglePlay);
$("reset-zoom").addEventListener("click", resetZoom);
$("charts").addEventListener("mouseleave", () => { if (!playing) hideTip(); });
window.addEventListener("resize", () => al && drawMap(al, cursorIdx));
