// Workbench panels. Each panel: { title, w, h, render(body, ctx) }.
// ctx: { d: latest Workbench doc, slow: latest slow part, alias(name), setFocus(idx), segments, rain }
import { escapeHtml as esc } from "./nav.js";
import { fmtLap, fmtDelta } from "./fmt.js";
import { mapFit, strokeOutline } from "./track-map.js";

const COMPOUND_COLOR = { Soft: "var(--soft)", Medium: "var(--medium)", Hard: "var(--hard)", Inter: "var(--inter)", Wet: "var(--wet)" };
const COMPOUND_LETTER = { Soft: "S", Medium: "M", Hard: "H", Inter: "I", Wet: "W" };
const ERS_NAME = { None: "none", Medium: "medium", Hotlap: "hotlap", Boost: "boost" };
const WEATHER_NAME = ["Clear", "Light cloud", "Overcast", "Light rain", "Heavy rain", "Storm"];
const DAMAGE = [["frontLeftWing", "Front left wing"], ["frontRightWing", "Front right wing"], ["rearWing", "Rear wing"],
  ["floor", "Floor"], ["diffuser", "Diffuser"], ["sidepod", "Sidepod"]];
const WHEELS = ["Rear left", "Rear right", "Front left", "Front right"]; // data order RL, RR, FL, FR

export const tyreBadge = (c) => `<span class="tyre-badge" style="--c:${COMPOUND_COLOR[c] || "var(--line)"}" title="${esc(c || "")}">${COMPOUND_LETTER[c] || "?"}</span>`;
const empty = (t) => `<p class="wb-muted">${t}</p>`;
const tempColor = (t) => (t < 80 ? "var(--cold)" : t > 105 ? "var(--hot)" : "var(--thr)");

function weatherIcon(w) {
  const sun = `<circle cx="12" cy="12" r="5" fill="var(--medium)"/>`;
  const cloud = (fill) => `<path d="M7 18h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.4A3.3 3.3 0 0 0 7 18z" fill="${fill}"/>`;
  const drops = (n) => Array.from({ length: n }, (_, i) => `<line x1="${8 + i * 4}" y1="20" x2="${7 + i * 4}" y2="23" stroke="var(--wet)" stroke-width="1.6" stroke-linecap="round"/>`).join("");
  const body = [sun, sun + cloud("var(--dim)"), cloud("var(--dim)"), cloud("var(--dim)") + drops(2),
    cloud("var(--line)") + drops(3), cloud("var(--line)") + drops(3) + `<path d="M13 13l-2 4h3l-2 4" stroke="var(--medium)" fill="none" stroke-width="1.5"/>`][w] || sun;
  return `<svg viewBox="0 0 24 24" width="24" height="24" aria-label="${WEATHER_NAME[w] || ""}" role="img">${body}</svg>`;
}

export const PANELS = {
  lap: {
    title: "Sectors & lap", w: 3, h: 4,
    render(el, { d }) {
      const p = d.player;
      if (!p) return (el.innerHTML = empty("No lap data yet."));
      const box = (label, ms, cls) => `<div class="sec ${cls}"><span>${label}</span><b>${ms ? fmtLap(ms) : "…"}</b></div>`;
      const best = d.session || {};
      const cls = (ms, b) => (!ms ? "pending" : b && ms <= b ? "purple" : "done");
      let delta = null, ref = "";
      if (p.prevLap) {
        if (p.sector >= 1 && p.s1) { delta = p.s1 - p.prevS1; ref = "S1"; }
        if (p.sector >= 2 && p.s2) { delta = p.s1 + p.s2 - p.prevS1 - p.prevS2; ref = "S2"; }
      }
      el.innerHTML = `
        <div class="secs">${box("S1", p.s1, cls(p.s1, best.bestS1))}${box("S2", p.s2, cls(p.s2, best.bestS2))}${box("S3", null, "pending")}</div>
        <div class="lap-delta"><span>Delta</span><b class="${delta == null ? "" : delta <= 0 ? "good" : "bad"}">${delta == null ? "–" : fmtDelta(delta)}</b>
          <em>${p.prevLap ? `vs lap ${p.prevLap}, at end of ${ref || "sector"}` : "no previous lap"}</em></div>
        <div class="lap-foot"><div><span>Lap ${p.lap}</span><b>${fmtLap(p.curLapMs)}</b></div>
          <div><span>Speed trap</span><b>${p.speedTrap ? `${p.speedTrap.toFixed(0)} km/h` : "–"}</b></div>
          <span class="pill ${p.invalid ? "bad" : "good"}">${p.invalid ? "Invalid" : "Valid"}</span></div>`;
    },
  },

  weather: {
    title: "Weather forecast", w: 5, h: 4,
    render(el, { slow }) {
      const f = slow?.forecast || [];
      if (!f.length) return (el.innerHTML = empty("No forecast yet."));
      const groups = [];
      for (const x of f) { const g = groups.at(-1); g && g.session === x.session ? g.items.push(x) : groups.push({ session: x.session, items: [x] }); }
      const rainy = f.some((x) => x.rain > 30 || x.weather >= 3);
      el.innerHTML = `<div class="fc-groups">${groups.map((g, gi) => `
        <div class="fc-group ${gi === 0 ? "now" : ""}"><h4>${esc(g.session)}${gi === 0 ? ", now" : ""}</h4>
          <div class="fc-row">${g.items.map((x) => `<div class="fc"><span>+${x.offset} min</span>${weatherIcon(x.weather)}<b>${x.rain}%</b><small>${x.trackTemp}°</small></div>`).join("")}</div></div>`).join("")}</div>
        <p class="fc-sum">${rainy ? "Rain expected, keep an eye on the intermediates." : "Dry conditions expected."}
        <span class="pill ${slow.forecastAccurate ? "good" : ""}">${slow.forecastAccurate ? "Accurate forecast" : "Approximate forecast"}</span></p>`;
    },
  },

  prediction: {
    title: "Game tyre prediction", w: 2, h: 4,
    render(el, { slow }) {
      const sets = (slow?.tyreSets || []).filter((t) => t.available);
      if (!sets.length) return (el.innerHTML = empty("The game only sends tyre data for your own car."));
      const best = {};
      for (const t of sets) if (!t.fitted && (!best[t.visual] || t.lapDeltaMs < best[t.visual].lapDeltaMs)) best[t.visual] = t;
      const rows = Object.values(best).sort((a, b) => a.lapDeltaMs - b.lapDeltaMs);
      const top = rows[0];
      el.innerHTML = top ? `
        <p class="pred-big">${esc(top.actual || top.visual)}</p>
        <p class="pred-sub">Fresh ${esc(top.visual.toLowerCase())}: ${(Math.abs(top.lapDeltaMs) / 1000).toFixed(3)} s ${top.lapDeltaMs <= 0 ? "faster" : "slower"} than current</p>
        <table class="mini">${rows.map((t) => `<tr><td>${tyreBadge(t.visual)} ${esc(t.actual || t.visual)}</td><td class="${t.lapDeltaMs <= 0 ? "good" : "bad"}">${fmtDelta(t.lapDeltaMs)}</td></tr>`).join("")}</table>`
        : empty("No other set available.");
    },
  },

  damage: {
    title: "Damage", w: 2, h: 4,
    render(el, { d }) {
      const dm = d.focus?.damage;
      if (!dm) return (el.innerHTML = empty("No data yet."));
      const any = DAMAGE.some(([k]) => dm[k] > 0);
      el.innerHTML = `<div class="dmg">${DAMAGE.map(([k, n]) => `<div class="${dm[k] >= 30 ? "bad" : dm[k] > 0 ? "warn" : "ok"}"><span>${n}</span><b>${dm[k]}%</b></div>`).join("")}</div>
        <p class="dmg-sum ${any ? "warn" : "good"}">${any ? "Damage reported" : "All clear"}</p>`;
    },
  },

  timing: {
    title: "Timing", w: 8, h: 10,
    render(el, { d, alias, setFocus }) {
      const s = d.session || {};
      const cars = d.cars;
      const tl = s.timeLeft ? `${Math.floor(s.timeLeft / 60)}:${String(s.timeLeft % 60).padStart(2, "0")}` : "–";
      el.innerHTML = `
        <div class="tt-head"><span>Time left <b>${tl}</b></span><span>Theoretical best <b>${fmtLap(s.theoreticalBestMs)}</b></span><span>Cars on track <b>${s.carsOnTrack ?? "–"}</b></span></div>
        <div class="table-wrap"><table class="tt">
          <thead><tr><th>P</th><th></th><th>Driver</th><th>Team</th><th>Best</th><th>Gap</th><th>S1</th><th>S2</th><th>S3</th><th>Trap</th><th>Laps</th><th>Tyre</th><th>Status</th></tr></thead>
          <tbody>${cars.map((c) => {
            const lead = cars.find((x) => x.bestLapMs) ;
            const gap = c.bestLapMs && s.sessionBestLapMs && c.bestLapMs !== s.sessionBestLapMs ? fmtDelta(c.bestLapMs - s.sessionBestLapMs) : "";
            const sc = (v, b, pb) => (v && b && v <= b ? "purple" : "");
            return `<tr data-focus="${c.idx}" class="${c.isPlayer ? "me" : ""} ${c.idx === d.focusIdx ? "focus" : ""}" tabindex="0">
              <td>${c.position}</td><td><i class="teamc" style="background:${c.color || "var(--line)"}"></i></td>
              <td class="name">${esc(alias(c.name))}${c.ai ? "" : ""}</td><td class="dim">${esc(c.team || "")}</td>
              <td class="${c.bestLapMs && c.bestLapMs === s.sessionBestLapMs ? "purple" : "amber"}">${fmtLap(c.bestLapMs)}</td>
              <td>${gap}</td>
              <td class="${sc(c.bestS1, s.bestS1)}">${fmtLap(c.bestS1)}</td><td class="${sc(c.bestS2, s.bestS2)}">${fmtLap(c.bestS2)}</td><td class="${sc(c.bestS3, s.bestS3)}">${fmtLap(c.bestS3)}</td>
              <td>${c.speedTrap ? c.speedTrap.toFixed(0) : "–"}</td><td>${c.laps}</td><td>${tyreBadge(c.compound)}</td><td class="dim">${esc(c.status || "")}</td></tr>`;
          }).join("")}</tbody></table></div>`;
      el.querySelector("tbody").onclick = (e) => { const tr = e.target.closest("tr[data-focus]"); if (tr) setFocus(Number(tr.dataset.focus)); };
    },
  },

  map: {
    title: "Track map", w: 4, h: 10,
    render(el, { d, slow, alias, setFocus, opts }) {
      if (!el.querySelector("canvas")) {
        el.innerHTML = `<div class="map-tools"><label><input type="checkbox" data-opt="team"> Team names</label><label><input type="checkbox" data-opt="spot"> Selected only</label></div>
          <p class="map-hint" hidden>Track outline fills in as cars drive</p>
          <canvas class="map-cv"></canvas>`;
        el.querySelectorAll("input[data-opt]").forEach((i) => { i.checked = !!opts[i.dataset.opt]; i.onchange = () => (opts[i.dataset.opt] = i.checked); });
        el.querySelector("canvas").onclick = (e) => {
          const hit = (el._dots || []).find((p) => Math.hypot(p.x - e.offsetX, p.y - e.offsetY) < 10);
          if (hit) setFocus(hit.idx);
        };
      }
      const cv = el.querySelector("canvas");
      const hint = el.querySelector(".map-hint");
      const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      const ctx = cv.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const outline = slow?.outline?.length ? slow.outline : el._outline || [];
      el._outline = outline;
      const ready = outline.length >= 8;
      const carPts = d.cars.filter((c) => c.x !== 0 || c.z !== 0).map((c) => [c.x, c.z]);
      const pts = ready ? outline : carPts;
      if (!pts.length) return;
      const P = mapFit(pts, w, h);
      if (!P) return;
      const css = getComputedStyle(document.documentElement);
      hint.hidden = ready;
      if (ready) {
        ctx.lineJoin = ctx.lineCap = "round";
        ctx.strokeStyle = css.getPropertyValue("--dim"); ctx.lineWidth = 10;
        ctx.globalAlpha = 0.55;
        strokeOutline(ctx, outline, P);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = css.getPropertyValue("--chalk"); ctx.lineWidth = 2.5; ctx.globalAlpha = 0.35;
        strokeOutline(ctx, outline, P);
        ctx.globalAlpha = 1;
      }
      el._dots = [];
      ctx.font = "600 11px IBM Plex Sans";
      for (const c of [...d.cars].reverse()) {
        if (c.x === 0 && c.z === 0) continue;
        if (opts.spot && c.idx !== d.focusIdx && !c.isPlayer) continue;
        const [x, y] = P(c.x, c.z);
        el._dots.push({ x, y, idx: c.idx });
        ctx.beginPath(); ctx.arc(x, y, c.idx === d.focusIdx ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = c.color || css.getPropertyValue("--chalk"); ctx.fill();
        ctx.lineWidth = c.isPlayer || c.idx === d.focusIdx ? 2.5 : 1.5;
        ctx.strokeStyle = c.isPlayer ? css.getPropertyValue("--amber") : c.idx === d.focusIdx ? css.getPropertyValue("--chalk") : css.getPropertyValue("--asphalt");
        ctx.stroke();
        const label = opts.team ? c.team : (alias(c.name) !== c.name ? alias(c.name) : c.short) + (c.ai ? " (AI)" : "");
        ctx.fillStyle = css.getPropertyValue("--chalk");
        const tw = ctx.measureText(label || "").width;
        ctx.fillText(label || "", x + 9 + tw > w - 4 ? x - 9 - tw : x + 9, y - 6);
      }
    },
  },

  session: {
    title: "Session", w: 2, h: 5,
    render(el, { d }) {
      const s = d.session;
      if (!s) return (el.innerHTML = empty("No session yet."));
      const tl = `${Math.floor(s.timeLeft / 60)}:${String(s.timeLeft % 60).padStart(2, "0")}`;
      el.innerHTML = `<dl class="kv tight">${[["Track", s.track], ["Session", s.type], ["Weather", WEATHER_NAME[s.weather]], ["Air", `${s.airTemp} °C`],
        ["Track temp", `${s.trackTemp} °C`], ["Pit limit", `${s.pitSpeed} km/h`], ["Time left", tl], ["Laps", s.totalLaps], ["Online", s.online ? "yes" : "no"]]
        .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(String(v ?? "–"))}</dd></div>`).join("")}</dl>`;
    },
  },

  wear: {
    title: "Tyre wear", w: 2, h: 5,
    render(el, { d, alias }) {
      const f = d.focus;
      if (!f) return (el.innerHTML = empty("No data yet."));
      const order = [[2, "FL"], [3, "FR"], [0, "RL"], [1, "RR"]];
      el.innerHTML = `<p class="who-line">${esc(alias(f.name))}, ${tyreBadge(f.compound)} ${f.tyreAge} laps</p>` + order.map(([i, n]) => {
        const w = f.tyreWear[i] || 0;
        return `<div class="bar-row"><span>${n}</span><i><b style="width:${Math.min(100, w)}%;background:${w > 60 ? "var(--brk)" : w > 35 ? "var(--medium)" : "var(--thr)"}"></b></i><em>${w.toFixed(1)}%</em></div>`;
      }).join("");
    },
  },

  spotlight: {
    title: "Selected driver tyre temps", w: 3, h: 5,
    render(el, { d, alias }) {
      const f = d.focus;
      if (!f) return (el.innerHTML = empty("Click a driver in the timing table or on the map."));
      const cell = (i) => `<div class="sp-tyre" style="--t:${tempColor(f.tyreInner[i])}"><span>${WHEELS[i]}</span><b>${f.tyreInner[i]} °C</b><small>surface ${f.tyreSurface[i]} °C, brake ${f.brakeTemp[i]} °C</small></div>`;
      el.innerHTML = `<p class="who-line"><b>${esc(alias(f.name))}</b>${f.restricted ? ' <span class="pill">restricted telemetry</span>' : ""}</p>
        <div class="sp-grid">${cell(2)}${cell(3)}${cell(0)}${cell(1)}</div>`;
    },
  },

  car: {
    title: "Car status", w: 2, h: 5,
    render(el, { d }) {
      const f = d.focus;
      if (!f) return (el.innerHTML = empty("No data yet."));
      const store = Math.max(0, Math.min(100, (f.ersStoreMJ / 4) * 100));
      el.innerHTML = `<div class="tiles">
          <div><span>Speed</span><b>${f.speed} km/h</b></div><div><span>Engine</span><b class="${f.engineTemp > 115 ? "bad" : ""}">${f.engineTemp} °C</b></div>
          <div><span>Gear</span><b>${f.gear < 0 ? "R" : f.gear === 0 ? "N" : f.gear}</b></div><div><span>RPM</span><b>${f.rpm}</b></div>
          <div><span>DRS</span><b class="${f.drs ? "good" : "dim"}">${f.drs ? "Open" : f.drsAllowed ? "Available" : "Closed"}</b></div><div><span>Brake bias</span><b>${f.brakeBias}%</b></div>
        </div>
        <div class="ers-line"><span>ERS</span><em>${ERS_NAME[f.ersMode] || f.ersMode}</em><i><b style="width:${store}%"></b></i><strong>${f.ersStoreMJ.toFixed(2)} MJ</strong></div>
        <p class="wb-muted small">Aero: ${esc(f.aero || "–")}, Overtake: ${esc(f.overtake || "–")}, fuel ${f.fuel.toFixed(1)} kg (${f.fuelLaps >= 0 ? "+" : ""}${f.fuelLaps.toFixed(2)} laps)</p>`;
    },
  },

  rain: {
    title: "Rain", w: 3, h: 5,
    render(el, { d, slow, rain }) {
      const now = d.session?.rainNow ?? 0;
      const per = rain.changePerMin();
      const f = (slow?.forecast || []).filter((x) => x.session === d.session?.type);
      const W = 300, H = 110;
      const maxOff = Math.max(10, ...f.map((x) => x.offset));
      const pts = f.map((x) => [20 + (x.offset / maxOff) * (W - 30), H - 14 - (x.rain / 100) * (H - 24)]);
      el.innerHTML = `<div class="rain-top"><div><span>Now</span><b class="rain">${now}%</b></div><div><span>Change per minute</span><b>${per == null ? "–" : `${per > 0 ? "+" : ""}${per.toFixed(1)}%`}</b></div></div>
        <svg viewBox="0 0 ${W} ${H}" class="rain-chart" role="img" aria-label="Rain forecast">
          ${[0, 50, 100].map((v) => `<line x1="20" x2="${W - 10}" y1="${H - 14 - (v / 100) * (H - 24)}" y2="${H - 14 - (v / 100) * (H - 24)}" stroke="var(--line)"/><text x="0" y="${H - 10 - (v / 100) * (H - 24)}" fill="var(--dim)" font-size="9">${v}%</text>`).join("")}
          ${pts.length ? `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="var(--cold)" stroke-width="2"/>${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="var(--cold)"/>`).join("")}` : ""}
          ${f.map((x, i) => `<text x="${pts[i][0]}" y="${H - 1}" fill="var(--dim)" font-size="9" text-anchor="middle">+${x.offset}</text>`).join("")}
        </svg>`;
    },
  },

  segments: {
    title: "Qualifying segments", w: 6, h: 8,
    render(el, { segments, alias, opts }) {
      const seg = opts.seg || "all";
      const types = { q1: 5, q2: 6, q3: 7, short: 8 };
      const rows = new Map();
      for (const r of segments.data) {
        const x = rows.get(r.driver) ?? { driver: r.driver, by: {} };
        x.by[r.sessionType] = r;
        rows.set(r.driver, x);
      }
      const pickBest = (x) => {
        const cands = Object.values(x.by).filter((r) => seg === "all" || r.sessionType === types[seg]);
        return cands.sort((a, b) => a.bestLapMs - b.bestLapMs)[0];
      };
      const list = [...rows.values()].map((x) => ({ ...x, best: pickBest(x) })).filter((x) => x.best).sort((a, b) => a.best.bestLapMs - b.best.bestLapMs);
      const minS = (k) => Math.min(...list.map((x) => x.best[k] || Infinity));
      const b1 = minS("s1"), b2 = minS("s2"), b3 = minS("s3");
      el.innerHTML = `<div class="seg-tabs">${[["all", "All"], ["q1", "Q1"], ["q2", "Q2"], ["q3", "Q3"], ["short", "Short Q"]]
        .map(([k, n]) => `<button class="${k === seg ? "on" : ""}" data-seg="${k}">${n}</button>`).join("")}<span class="wb-muted small">${segments.note}</span></div>
        <div class="table-wrap"><table class="tt"><thead><tr><th>P</th><th>Driver</th><th>Best</th><th>S1</th><th>S2</th><th>S3</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Short Q</th><th>Laps (Q1/Q2/Q3/SQ)</th></tr></thead>
        <tbody>${list.map((x, i) => `<tr><td>${i + 1}</td><td class="name">${esc(alias(x.driver))}</td><td class="amber">${fmtLap(x.best.bestLapMs)}</td>
          <td class="${x.best.s1 === b1 ? "purple" : ""}">${fmtLap(x.best.s1)}</td><td class="${x.best.s2 === b2 ? "purple" : ""}">${fmtLap(x.best.s2)}</td><td class="${x.best.s3 === b3 ? "purple" : ""}">${fmtLap(x.best.s3)}</td>
          <td>${fmtLap(x.by[5]?.bestLapMs)}</td><td>${fmtLap(x.by[6]?.bestLapMs)}</td><td>${fmtLap(x.by[7]?.bestLapMs)}</td><td>${fmtLap(x.by[8]?.bestLapMs)}</td>
          <td>${x.by[5]?.laps ?? 0}/${x.by[6]?.laps ?? 0}/${x.by[7]?.laps ?? 0}/${x.by[8]?.laps ?? 0}</td></tr>`).join("") || `<tr><td colspan="11">No qualifying laps on this track in the last 12 hours.</td></tr>`}</tbody></table></div>`;
      el.querySelectorAll("[data-seg]").forEach((b) => (b.onclick = () => (opts.seg = b.dataset.seg)));
    },
  },

  minis: {
    title: "Mini sectors", w: 6, h: 9,
    render(el, { d, alias, setFocus }) {
      const rows = new Map((d.minis || []).map((m) => [m.idx, m]));
      if (!d.cars.length) return (el.innerHTML = empty("No cars on track."));
      const n = 24;
      const cls = ["", "slow", "pb", "purple"];
      el.innerHTML = `<div class="lm-legend"><span class="ms purple"></span>fastest overall <span class="ms pb"></span>personal best <span class="ms cur"></span>current segment</div>
        <div class="table-wrap"><table class="ms-table"><thead><tr><th>P</th><th>Driver</th>${Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join("")}</tr></thead><tbody>
        ${d.cars.map((c) => {
          const m = rows.get(c.idx);
          const out = c.pitStatus === 2 || c.status === "In garage";
          return `<tr data-focus="${c.idx}" class="${out ? "out" : ""} ${c.idx === d.focusIdx ? "focus" : ""}"><td>${c.position}</td>
            <td class="name"><i class="teamc" style="background:${c.color || "var(--line)"}"></i>${esc(alias(c.name) !== c.name ? alias(c.name) : c.short)}</td>${
            Array.from({ length: n }, (_, i) => `<td><span class="ms ${cls[m?.cells[i] ?? 0]} ${m && m.current === i ? "cur" : ""}"></span></td>`).join("")}</tr>`;
        }).join("")}</tbody></table></div>`;
      el.querySelector("tbody").onclick = (e) => { const tr = e.target.closest("tr[data-focus]"); if (tr) setFocus(Number(tr.dataset.focus)); };
    },
  },

  lapMatrix: {
    title: "Lap matrix", w: 6, h: 8,
    render(el, { d, slow, alias }) {
      const rows = slow?.lapMatrix;
      if (!rows?.length) return (el.innerHTML = empty("No completed laps yet."));
      const byIdx = new Map(rows.map((r) => [r.idx, r]));
      const nLaps = Math.max(...rows.map((r) => r.laps.length));
      let fastest = Infinity;
      for (const r of rows) for (const c of r.laps) if (c.valid && c.ms && c.ms < fastest) fastest = c.ms;
      el.innerHTML = `<div class="lm-legend"><span class="lm purple"></span>fastest <span class="lm pb"></span>personal best <span class="lm ok"></span>valid <span class="lm bad"></span>invalid <span class="lm cur"></span>in progress</div>
        <div class="table-wrap"><table class="lm-table"><thead><tr><th>P</th><th>Driver</th>${Array.from({ length: nLaps }, (_, i) => `<th>${i + 1}</th>`).join("")}</tr></thead><tbody>
        ${d.cars.map((c) => {
          const r = byIdx.get(c.idx);
          const laps = r?.laps || [];
          let pb = Infinity;
          for (const x of laps) if (x.valid && x.ms && x.ms < pb) pb = x.ms;
          return `<tr><td>${c.position}</td><td class="name"><i class="teamc" style="background:${c.color || "var(--line)"}"></i>${esc(alias(c.short || c.name))}</td>${
            Array.from({ length: nLaps }, (_, i) => {
              const x = laps[i];
              if (!x) return "<td></td>";
              const k = !x.ms ? "cur" : !x.valid ? "bad" : x.ms === fastest ? "purple" : x.ms === pb ? "pb" : "ok";
              return `<td><span class="lm ${k}" title="${x.ms ? fmtLap(x.ms) : "folyamatban"}"></span></td>`;
            }).join("")}</tr>`;
        }).join("")}</tbody></table></div>`;
    },
  },

  tyreSets: {
    title: "Tyre sets", w: 6, h: 5,
    render(el, { slow }) {
      const sets = slow?.tyreSets || [];
      if (!sets.length) return (el.innerHTML = empty("The game only sends tyre set data for your own car."));
      el.innerHTML = `<div class="ts-row">${sets.map((t) => `
        <div class="ts ${t.fitted ? "fitted" : ""} ${t.available ? "" : "gone"}">
          <span>Set ${t.index}</span><small>${esc(t.recommended)}</small>
          ${tyreBadge(t.visual)}<small>${esc(t.actual || "")}</small>
          <b>${t.wear}%</b><small>${t.lifeSpan} / ${t.usableLife} laps</small>
          <em class="${t.fitted ? "" : t.lapDeltaMs <= 0 ? "good" : "bad"}">${t.fitted ? "fitted" : fmtDelta(t.lapDeltaMs)}</em>
        </div>`).join("")}</div>`;
    },
  },

  setup: {
    title: "Car setup", w: 6, h: 5,
    render(el, { slow }) {
      const s = slow?.setup;
      if (!s) return (el.innerHTML = empty("No setup data yet."));
      const g = (title, rows) => `<div class="su-g"><h4>${title}</h4>${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>`;
      el.innerHTML = `<div class="su">${
        g("Aero", [["Front wing", s.FrontWing], ["Rear wing", s.RearWing]]) +
        g("Transmission", [["Diff on throttle", `${s.OnThrottle}%`], ["Diff off throttle", `${s.OffThrottle}%`], ["Engine braking", `${s.EngineBraking}%`]]) +
        g("Geometry", [["Front camber", s.FrontCamber.toFixed(2)], ["Rear camber", s.RearCamber.toFixed(2)], ["Front toe", s.FrontToe.toFixed(2)], ["Rear toe", s.RearToe.toFixed(2)]]) +
        g("Suspension", [["Front springs", s.FrontSusp], ["Rear springs", s.RearSusp], ["Front anti-roll bar", s.FrontARB], ["Rear anti-roll bar", s.RearARB], ["Front ride height", s.FrontHeight], ["Rear ride height", s.RearHeight]]) +
        g("Brakes", [["Brake bias", `${s.BrakeBias}%`], ["Brake pressure", `${s.BrakePressure}%`]]) +
        g("Tyre pressure (psi)", [["Front left", s.PressFL.toFixed(1)], ["Front right", s.PressFR.toFixed(1)], ["Rear left", s.PressRL.toFixed(1)], ["Rear right", s.PressRR.toFixed(1)]]) +
        g("Other", [["Fuel load", `${s.FuelLoad.toFixed(1)} kg`], ["Ballast", s.Ballast]])}</div>`;
    },
  },

  events: {
    title: "Race control", w: 4, h: 6,
    render(el, { d }) {
      const ev = [...(d.events || [])].reverse();
      el.innerHTML = ev.length ? `<ol class="ev">${ev.map((e) => `<li class="${["PENA", "COLL", "SCAR", "RDFL"].includes(e.code) ? "hot" : ""}"><time>${Math.floor(e.t / 60)}:${String(Math.floor(e.t % 60)).padStart(2, "0")}</time>${esc(e.text)}</li>`).join("")}</ol>` : empty("Nothing has happened yet.");
    },
  },

  inputs: {
    title: "Throttle & brake", w: 4, h: 4,
    render(el, { d, trace }) {
      const f = d.focus;
      if (!f) return (el.innerHTML = empty("No data yet."));
      trace.push(f);
      const pts = trace.points;
      const W = 400, H = 120;
      const line = (key, scale) => pts.map((p, i) => `${(i / Math.max(1, pts.length - 1)) * W},${H - 4 - (p[key] / scale) * (H - 8)}`).join(" ");
      el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="inp-chart" role="img" aria-label="Throttle, brake and speed over the last 15 seconds">
        <polyline points="${line("throttle", 1)}" fill="none" stroke="var(--thr)" stroke-width="2"/>
        <polyline points="${line("brake", 1)}" fill="none" stroke="var(--brk)" stroke-width="2"/>
        <polyline points="${line("speed", 360)}" fill="none" stroke="var(--chalk)" stroke-width="1.5"/></svg>
        <p class="wb-muted small">Green: throttle, red: brake, white: speed (last 15 s)</p>`;
    },
  },
};

export const DEFAULT_VIEWS = [
  { name: "Default", layout: [
    ["lap", 3, 4], ["weather", 5, 4], ["prediction", 2, 4], ["damage", 2, 4],
    ["timing", 8, 10], ["map", 4, 10],
    ["session", 2, 6], ["wear", 2, 6], ["spotlight", 3, 6], ["car", 2, 6], ["rain", 3, 6],
    ["segments", 6, 9], ["minis", 6, 9], ["tyreSets", 6, 5], ["setup", 6, 5]] },
  { name: "Qualifying", layout: [["lap", 3, 4], ["weather", 5, 4], ["prediction", 2, 4], ["damage", 2, 4], ["timing", 8, 10], ["map", 4, 10], ["minis", 7, 9], ["segments", 5, 9], ["tyreSets", 12, 5]] },
  { name: "Race", layout: [["lap", 3, 4], ["car", 3, 4], ["wear", 3, 4], ["damage", 3, 4], ["timing", 8, 10], ["map", 4, 10], ["minis", 8, 9], ["events", 4, 9], ["rain", 4, 5], ["spotlight", 4, 5], ["inputs", 4, 5]] },
];
