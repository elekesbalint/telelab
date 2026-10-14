// Lap comparison: two laps aligned by distance around the lap.
import { initNav, escapeHtml } from "./nav.js";
import { fmtLap, fmtDelta, fmtDate } from "./fmt.js";

await initNav();
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const parseRef = (s) => { const [sid, lap] = String(s || "").split(":").map(Number); return sid && lap ? { sid, lap } : null; };
const refA = parseRef(params.get("a"));
let refB = parseRef(params.get("b"));
const css = getComputedStyle(document.documentElement);
const col = (v) => css.getPropertyValue(v).trim();
const COLOR_A = col("--amber"), COLOR_B = col("--cold");
const STEP = 4; // metres between aligned samples

if (!refA) { $("charts").innerHTML = `<p class="lead">Hiányzik az összehasonlítandó kör. Válassz egyet a <a href="/sessions.html">Sessionök</a> oldalon.</p>`; throw new Error("no lap"); }
$("back").href = `/session.html?id=${refA.sid}`;

const load = async (ref) => {
  const [lap, ses] = await Promise.all([
    fetch(`/api/sessions/${ref.sid}/laps/${ref.lap}/telemetry`).then((r) => (r.ok ? r.json() : null)),
    fetch(`/api/sessions/${ref.sid}`).then((r) => (r.ok ? r.json() : null)),
  ]);
  return lap && { ...lap, session: ses, ref };
};

let A = await load(refA);
let B = refB ? await load(refB) : null;
let plots = [];

render();

function render() {
  card($("card-a"), A, "A", false);
  card($("card-b"), B, "B", true);
  for (const p of plots) p.destroy();
  plots = [];
  $("charts").innerHTML = "";
  if (!A?.dist?.length) {
    $("charts").innerHTML = `<p class="lead">Ehhez a körhöz nincs mentett telemetria. Telemetria csak a saját autódról van, a TeleLab telepítése utáni körökből.</p>`;
    $("verdict").innerHTML = "";
    return;
  }
  const al = align(A, B?.dist?.length ? B : null);
  verdict(al);
  charts(al);
  drawMap(al, null);
}

function card(el, L, label, changeable) {
  if (!L) {
    el.innerHTML = `<h2><span class="tag">${label}</span> Nincs kiválasztva</h2>${changeable ? picker() : ""}`;
    if (changeable) wirePicker(el);
    return;
  }
  const s = L.session || {};
  el.innerHTML = `
    <h2><span class="tag">${label}</span> ${escapeHtml(L.driver || s.player || "?")}</h2>
    <p class="big">${fmtLap(L.lapTimeMs)}</p>
    <p class="meta">${escapeHtml(s.track || L.track || "")}, ${escapeHtml(s.type || "")}, ${L.lap}. kör, ${s.startedAt ? fmtDate(s.startedAt) : ""}${L.valid ? "" : ", érvénytelen"}</p>
    ${changeable ? picker() : ""}`;
  if (changeable) wirePicker(el);
}

function picker() {
  return `<details class="pick"><summary>Másik kör választása</summary>
    <label>Session <select class="p-ses"><option>Betöltés…</option></select></label>
    <label>Kör <select class="p-lap"></select></label>
    <button class="primary p-go">Betöltés</button></details>`;
}

function wirePicker(el) {
  const det = el.querySelector("details");
  det.addEventListener("toggle", async () => {
    if (!det.open || det.dataset.ready) return;
    det.dataset.ready = 1;
    const track = A?.session?.trackId;
    const list = await (await fetch(`/api/sessions?limit=200${track != null ? `&track=${track}` : ""}`)).json();
    const sesSel = el.querySelector(".p-ses"), lapSel = el.querySelector(".p-lap");
    sesSel.innerHTML = list.filter((s) => s.hasSamples).map((s) => `<option value="${s.id}">${escapeHtml(s.player)}, ${escapeHtml(s.type)}, ${fmtDate(s.startedAt)} (legjobb ${fmtLap(s.bestLapMs)})</option>`).join("");
    const fillLaps = async () => {
      const laps = (await (await fetch(`/api/sessions/${sesSel.value}/laps`)).json()).filter((l) => l.isPlayer);
      lapSel.innerHTML = laps.sort((a, b) => a.lapTimeMs - b.lapTimeMs)
        .map((l) => `<option value="${l.lapNum}">${l.lapNum}. kör, ${fmtLap(l.lapTimeMs)}${l.valid ? "" : " (érvénytelen)"}</option>`).join("");
    };
    sesSel.addEventListener("change", fillLaps);
    if (sesSel.value) await fillLaps();
    el.querySelector(".p-go").addEventListener("click", async () => {
      refB = { sid: Number(sesSel.value), lap: Number(lapSel.value) };
      params.set("b", `${refB.sid}:${refB.lap}`);
      history.replaceState(null, "", `?${params}`);
      B = await load(refB);
      render();
    });
  });
}

// ---------- alignment ----------
function interp(xs, ys, x, step) {
  // xs ascending; binary search
  let lo = 0, hi = xs.length - 1;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[hi]) return ys[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  if (step) return ys[lo];
  const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + (ys[hi] - ys[lo]) * f;
}

function monotonic(L) {
  // keep only increasing distance (guards against jitter at the line)
  const keep = [];
  let last = -Infinity;
  L.dist.forEach((d, i) => { if (d > last) { keep.push(i); last = d; } });
  const pick = (arr) => keep.map((i) => arr[i]);
  return { dist: pick(L.dist), t: pick(L.t), speed: pick(L.speed), throttle: pick(L.throttle), brake: pick(L.brake),
    gear: pick(L.gear), steer: pick(L.steer), ers: pick(L.ersMJ), rpm: pick(L.rpm), x: pick(L.x), z: pick(L.z) };
}

function align(LA, LB) {
  const a = monotonic(LA), b = LB ? monotonic(LB) : null;
  const end = Math.min(a.dist.at(-1), b ? b.dist.at(-1) : Infinity);
  const d = [];
  for (let x = 0; x <= end; x += STEP) d.push(x);
  const ch = (L, key, step) => {
    if (!L) return null;
    if (key === "x" || key === "z") {
      // positions: ignore samples taken before the first motion packet (0,0)
      const keep = L.x.map((v, i) => v !== 0 || L.z[i] !== 0);
      const ds = L.dist.filter((_, i) => keep[i]), vs = L[key].filter((_, i) => keep[i]);
      return ds.length ? d.map((x) => interp(ds, vs, x, false)) : d.map(() => 0);
    }
    return d.map((x) => interp(L.dist, L[key], x, step));
  };
  const out = { d, a: {}, b: b ? {} : null };
  for (const [key, step] of [["t"], ["speed"], ["throttle"], ["brake"], ["gear", true], ["steer"], ["ers"], ["rpm"], ["x"], ["z"]]) {
    out.a[key] = ch(a, key, step);
    if (b) out.b[key] = ch(b, key, step);
  }
  out.delta = b ? d.map((_, i) => (out.b.t[i] - out.a.t[i]) / 1000) : null;
  return out;
}

// ---------- verdict ----------
function verdict(al) {
  const el = $("verdict");
  if (!al.b) { el.innerHTML = `<h2>Egy kör</h2><p class="meta">Válassz B-kört az összehasonlításhoz.</p>`; return; }
  const diff = B.lapTimeMs - A.lapTimeMs;
  // biggest single gain/loss over 200 m windows
  const w = Math.round(200 / STEP);
  let best = { v: 0, i: 0 }, worst = { v: 0, i: 0 };
  for (let i = w; i < al.delta.length; i++) {
    const v = al.delta[i] - al.delta[i - w];
    if (v < best.v) best = { v, i };
    if (v > worst.v) worst = { v, i };
  }
  const where = (i) => `${Math.round(al.d[i - w])}–${Math.round(al.d[i])} m`;
  el.innerHTML = `
    <h2>${diff === 0 ? "Döntetlen" : diff > 0 ? "A a gyorsabb" : "B a gyorsabb"}</h2>
    <p class="big ${diff > 0 ? "ka" : "kb"}">${fmtDelta(Math.abs(diff))}</p>
    <dl class="kv">
      ${worst.v > 0.02 ? `<div><dt>B legtöbb vesztesége</dt><dd>${fmtDelta(worst.v * 1000)} (${where(worst.i)})</dd></div>` : ""}
      ${best.v < -0.02 ? `<div><dt>B legtöbb nyeresége</dt><dd>${fmtDelta(best.v * 1000)} (${where(best.i)})</dd></div>` : ""}
      <div><dt>Végsebesség A / B</dt><dd>${Math.max(...al.a.speed).toFixed(0)} / ${Math.max(...al.b.speed).toFixed(0)} km/h</dd></div>
    </dl>`;
}

// ---------- charts ----------
function charts(al) {
  const host = $("charts");
  const sync = uPlot.sync("cmp");
  const defs = [
    al.delta && { title: "Időkülönbség, B − A (mp)", h: 150, a: null, b: al.delta, fmt: (v) => fmtDelta(v * 1000), axis: (v) => (v > 0 ? "+" : "") + v.toFixed(2), zero: true },
    { title: "Sebesség (km/h)", h: 200, a: al.a.speed, b: al.b?.speed, fmt: (v) => `${v.toFixed(0)} km/h` },
    { title: "Gáz (%)", h: 110, a: al.a.throttle.map((v) => v * 100), b: al.b?.throttle.map((v) => v * 100), fmt: (v) => `${v.toFixed(0)}%`, range: [0, 100] },
    { title: "Fék (%)", h: 110, a: al.a.brake.map((v) => v * 100), b: al.b?.brake.map((v) => v * 100), fmt: (v) => `${v.toFixed(0)}%`, range: [0, 100] },
    { title: "Fokozat", h: 110, a: al.a.gear, b: al.b?.gear, fmt: (v) => String(Math.round(v)), stepped: true, incrs: [1, 2] },
    { title: "Kormány (bal −1, jobb +1)", h: 110, a: al.a.steer, b: al.b?.steer, fmt: (v) => v.toFixed(2), axis: (v) => v.toFixed(1), range: [-1, 1] },
    { title: "ERS töltöttség (MJ)", h: 110, a: al.a.ers, b: al.b?.ers, fmt: (v) => `${v.toFixed(2)} MJ`, axis: (v) => v.toFixed(1) },
  ].filter(Boolean);

  const readout = $("readout");
  for (const def of defs) {
    const box = document.createElement("section");
    box.className = "panel chart-box";
    box.innerHTML = `<h3>${def.title}<span class="val"></span></h3><div class="plot"></div>`;
    host.append(box);
    const series = [{}];
    const data = [al.d];
    const path = def.stepped ? uPlot.paths.stepped({ align: 1 }) : undefined;
    if (def.a) { series.push({ label: "A", stroke: COLOR_A, width: 1.6, paths: path, points: { show: false } }); data.push(def.a); }
    if (def.b) {
      const isDelta = !def.a;
      series.push({ label: "B", stroke: isDelta ? col("--chalk") : COLOR_B, width: 1.6, paths: path, points: { show: false },
        fill: isDelta ? "rgba(95,168,232,0.10)" : undefined });
      data.push(def.b);
    }
    const plotEl = box.querySelector(".plot");
    const valEl = box.querySelector(".val");
    const u = new uPlot({
      width: plotEl.clientWidth || 600, height: def.h,
      legend: { show: false },
      cursor: { sync: { key: sync.key, setSeries: false }, drag: { x: true, y: false }, points: { size: 6 } },
      scales: { x: { time: false }, y: def.range ? { range: def.range } : {} },
      axes: [
        { stroke: col("--dim"), grid: { stroke: col("--line"), width: 1 }, values: (u, v) => v.map((m) => `${(m / 1000).toFixed(1)} km`), show: def === defs.at(-1) },
        { stroke: col("--dim"), grid: { stroke: col("--line"), width: 1 }, size: 56, incrs: def.incrs, values: (u, v) => v.map(def.axis || ((x) => String(x))) },
      ],
      series,
      hooks: {
        setCursor: [(u) => {
          const i = u.cursor.idx;
          if (i == null) { valEl.textContent = ""; return; }
          const parts = [];
          if (def.a) parts.push(`<b class="ka">${def.fmt(def.a[i])}</b>`);
          if (def.b) parts.push(`<b class="${def.a ? "kb" : ""}">${def.fmt(def.b[i])}</b>`);
          valEl.innerHTML = parts.join(" ");
          if (def === defs[0]) {
            drawMap(al, i);
            readout.innerHTML = `<div><dt>Pozíció a körön</dt><dd>${Math.round(al.d[i])} m</dd></div>`;
          }
        }],
        draw: def.zero ? [(u) => {
          const y = u.valToPos(0, "y", true);
          u.ctx.save(); u.ctx.strokeStyle = col("--dim"); u.ctx.setLineDash([4, 4]);
          u.ctx.beginPath(); u.ctx.moveTo(u.bbox.left, y); u.ctx.lineTo(u.bbox.left + u.bbox.width, y); u.ctx.stroke(); u.ctx.restore();
        }] : [],
      },
    }, data, plotEl);
    sync.sub(u);
    plots.push(u);
    new ResizeObserver(() => u.setSize({ width: plotEl.clientWidth, height: def.h })).observe(plotEl);
  }
}

// ---------- track map ----------
function drawMap(al, cursorIdx) {
  const cv = $("map");
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const ok = al.a.x.map((x, i) => x !== 0 || al.a.z[i] !== 0);
  const xs = al.a.x, zs = al.a.z;
  if (!ok.some(Boolean)) { ctx.fillStyle = col("--dim"); ctx.fillText("Nincs pozícióadat", 12, 20); return; }
  const vx = xs.filter((_, i) => ok[i]), vz = zs.filter((_, i) => ok[i]);
  const minX = Math.min(...vx), maxX = Math.max(...vx), minZ = Math.min(...vz), maxZ = Math.max(...vz);
  const pad = 16, s = Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxZ - minZ || 1));
  const ox = (w - (maxX - minX) * s) / 2, oz = (h - (maxZ - minZ) * s) / 2;
  const P = (i) => [ox + (xs[i] - minX) * s, h - (oz + (zs[i] - minZ) * s)];

  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.lineWidth = 9; ctx.strokeStyle = col("--line");
  ctx.beginPath();
  let pen = false;
  xs.forEach((_, i) => { if (!ok[i]) { pen = false; return; } const [x, y] = P(i); pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; });
  ctx.stroke();

  if (al.delta) {
    // colour each ~40 m segment by who gained time on it
    const seg = Math.max(1, Math.round(40 / STEP));
    ctx.lineWidth = 5;
    for (let i = 0; i + seg < xs.length; i += seg) {
      const gain = al.delta[i + seg] - al.delta[i]; // >0: B lost time, A gained
      if (Math.abs(gain) < 0.002) continue;
      ctx.strokeStyle = gain > 0 ? COLOR_A : COLOR_B;
      if (!ok[i] || !ok[i + seg]) continue;
      ctx.beginPath();
      for (let k = i; k <= i + seg; k++) { const [x, y] = P(k); k === i ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }
  // start/finish
  const first = ok.indexOf(true);
  const [sx, sy] = P(first);
  ctx.fillStyle = col("--chalk"); ctx.fillRect(sx - 2, sy - 7, 4, 14);

  if (cursorIdx != null) {
    const dot = (L, color) => {
      const x = ox + (L.x[cursorIdx] - minX) * s, y = h - (oz + (L.z[cursorIdx] - minZ) * s);
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = col("--asphalt"); ctx.stroke();
    };
    if (al.b) dot(al.b, COLOR_B);
    dot(al.a, COLOR_A);
  }
}
window.addEventListener("resize", () => A?.dist?.length && drawMap(align(A, B?.dist?.length ? B : null), null));
