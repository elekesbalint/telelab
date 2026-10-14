// TeleLab Workbench: a pit-wall dashboard built from movable panels.
import { initNav, escapeHtml as esc } from "./nav.js";
import { PANELS, DEFAULT_VIEWS } from "./panels.js";

const $ = (id) => document.getElementById(id);
const me = await initNav();
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(`telelab.wb.${k}`)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`telelab.wb.${k}`, JSON.stringify(v)); } catch {} },
};

// ---------- state ----------
let views = [];          // [{id|null, key, name, layout, builtin, author}]
let current = null;      // view object being shown
let layout = [];         // [{uid, type, w, h, opts}]
let editing = false;
let dirty = false;
let doc = null, slow = null;
let ws = null, port = null;
let focusIdx = -1;
let aliases = {};
const segments = { data: [], note: "", track: null, at: 0 };

// rain change per minute from the observed "rain now" values
const rain = {
  hist: [],
  push(v) { const t = Date.now(); this.hist.push([t, v]); while (this.hist.length && t - this.hist[0][0] > 120000) this.hist.shift(); },
  changePerMin() {
    if (this.hist.length < 2) return null;
    const [t0, v0] = this.hist[0], [t1, v1] = this.hist.at(-1);
    return t1 - t0 < 20000 ? null : ((v1 - v0) / (t1 - t0)) * 60000;
  },
};
const trace = {
  points: [],
  push(f) { this.points.push({ throttle: f.throttle, brake: f.brake, speed: f.speed }); if (this.points.length > 150) this.points.shift(); },
};

let uidSeq = 1;
const fromCompact = (l) => l.map((p) => (Array.isArray(p) ? { uid: uidSeq++, type: p[0], w: p[1], h: p[2], opts: {} } : { uid: uidSeq++, opts: {}, ...p }))
  .filter((p) => PANELS[p.type]);
const toCompact = (l) => l.map(({ type, w, h, opts }) => ({ type, w, h, opts }));
const alias = (n) => (n && aliases[n]) || n || "?";

// ---------- views ----------
async function loadViews(selectKey) {
  let saved = [];
  try { saved = await (await fetch("/api/views")).json(); } catch {}
  views = [
    ...DEFAULT_VIEWS.map((v, i) => ({ id: null, key: `b${i}`, name: v.name, layout: v.layout, builtin: true })),
    ...saved.map((v) => ({ id: v.id, key: `v${v.id}`, name: v.name, layout: v.layout, author: v.author })),
  ];
  const sel = $("view");
  sel.innerHTML = `<optgroup label="Built-in">${views.filter((v) => v.builtin).map((v) => `<option value="${v.key}">${esc(v.name)}</option>`).join("")}</optgroup>` +
    (saved.length ? `<optgroup label="Team views">${views.filter((v) => !v.builtin).map((v) => `<option value="${v.key}">${esc(v.name)}${v.author ? `, ${esc(v.author)}` : ""}</option>`).join("")}</optgroup>` : "");
  const key = selectKey || store.get("view", "b0");
  showView(views.find((v) => v.key === key) || views[0]);
}

function showView(v) {
  current = v;
  $("view").value = v.key;
  store.set("view", v.key);
  layout = fromCompact(v.layout);
  dirty = false;
  updateButtons();
  build();
}

function updateButtons() {
  $("save").disabled = !dirty || current.builtin;
  $("save").title = current.builtin ? "Built-in views cannot be overwritten; save as a new view" : "";
  $("delete-view").hidden = current.builtin;
  $("save").textContent = dirty ? "Save*" : "Save";
}
const touch = () => { dirty = true; updateButtons(); };

$("view").onchange = () => {
  if (dirty && !confirm("Unsaved changes to this view will be lost. Continue?")) { $("view").value = current.key; return; }
  showView(views.find((v) => v.key === $("view").value));
};

$("save").onclick = async () => {
  if (current.builtin) return;
  const res = await fetch(`/api/views/${current.id}`, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: current.name, layout: toCompact(layout) }) });
  if (!res.ok) return alert(`Could not save: ${(await res.text()).trim()}`);
  current.layout = toCompact(layout);
  dirty = false; updateButtons();
};

$("save-as").onclick = async () => {
  const name = prompt("Name of the new view:", current.builtin ? `${current.name} (mine)` : `${current.name} copy`);
  if (!name) return;
  const res = await fetch("/api/views", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, layout: toCompact(layout) }) });
  if (!res.ok) return alert(`Could not save: ${(await res.text()).trim()}`);
  const { id } = await res.json();
  dirty = false;
  await loadViews(`v${id}`);
};

$("delete-view").onclick = async () => {
  if (current.builtin || !confirm(`Delete the view "${current.name}" for the whole team?`)) return;
  const res = await fetch(`/api/views/${current.id}`, { method: "DELETE" });
  if (!res.ok) return alert(`Could not delete: ${(await res.text()).trim()}`);
  dirty = false;
  await loadViews("b0");
};

$("export").onclick = () => {
  const blob = new Blob([JSON.stringify({ telelabView: 1, name: current.name, layout: toCompact(layout) }, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `telelab-view-${current.name.replace(/[^\p{L}\p{N}]+/gu, "-")}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
};
$("import").onclick = () => $("import-file").click();
$("import-file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const j = JSON.parse(await file.text());
    if (!Array.isArray(j.layout)) throw new Error("missing layout");
    layout = fromCompact(j.layout);
    current = { id: null, key: "import", name: j.name || "Imported view", builtin: true, layout: j.layout };
    dirty = true; updateButtons(); build();
    alert("Loaded. To keep it, click \"Save as new\".");
  } catch (err) { alert(`This is not a TeleLab view file (${err.message}).`); }
};

// ---------- editing ----------
$("edit").onclick = () => {
  editing = !editing;
  $("edit").setAttribute("aria-pressed", editing);
  $("edit").textContent = editing ? "Done editing" : "Edit";
  document.body.classList.toggle("editing", editing);
  build();
};
$("add").onclick = () => {
  $("catalog-list").innerHTML = Object.entries(PANELS).map(([k, p]) => `<button type="button" class="cat-item" data-type="${k}">${esc(p.title)}<small>${p.w}×${p.h}</small></button>`).join("");
  $("catalog").showModal();
};
$("catalog-list").onclick = (e) => {
  const b = e.target.closest("[data-type]");
  if (!b) return;
  const p = PANELS[b.dataset.type];
  layout.push({ uid: uidSeq++, type: b.dataset.type, w: p.w, h: p.h, opts: {} });
  touch(); build();
  $("catalog").close();
  $("grid").lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
};

// ---------- layout ----------
const panelEls = new Map();
function build() {
  const grid = $("grid");
  grid.innerHTML = "";
  panelEls.clear();
  for (const p of layout) {
    const def = PANELS[p.type];
    const el = document.createElement("section");
    el.className = "wb-panel";
    el.style.gridColumn = `span ${p.w}`;
    el.style.gridRow = `span ${p.h}`;
    el.dataset.uid = p.uid;
    el.innerHTML = `<header><h3>${esc(def.title)}</h3>${editing ? `<div class="pctl">
        <button data-a="w-" aria-label="Narrower" title="Narrower">◂</button><button data-a="w+" aria-label="Wider" title="Wider">▸</button>
        <button data-a="h-" aria-label="Shorter" title="Shorter">▴</button><button data-a="h+" aria-label="Taller" title="Taller">▾</button>
        <button data-a="up" aria-label="Move earlier" title="Move earlier">↑</button><button data-a="down" aria-label="Move later" title="Move later">↓</button>
        <button data-a="x" aria-label="Remove panel" title="Remove">✕</button></div>` : ""}</header><div class="wb-body-in"></div>`;
    if (editing) {
      el.draggable = true;
      el.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", p.uid); el.classList.add("dragging"); });
      el.addEventListener("dragend", () => el.classList.remove("dragging"));
      el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("over"); });
      el.addEventListener("dragleave", () => el.classList.remove("over"));
      el.addEventListener("drop", (e) => {
        e.preventDefault(); el.classList.remove("over");
        const from = layout.findIndex((x) => String(x.uid) === e.dataTransfer.getData("text/plain"));
        const to = layout.findIndex((x) => x.uid === p.uid);
        if (from < 0 || from === to) return;
        const [m] = layout.splice(from, 1);
        layout.splice(to, 0, m);
        touch(); build();
      });
      el.querySelector(".pctl").onclick = (e) => {
        const a = e.target.dataset.a;
        if (!a) return;
        const i = layout.indexOf(p);
        if (a === "w-") p.w = Math.max(2, p.w - 1);
        if (a === "w+") p.w = Math.min(12, p.w + 1);
        if (a === "h-") p.h = Math.max(2, p.h - 1);
        if (a === "h+") p.h = Math.min(20, p.h + 1);
        if (a === "up" && i > 0) [layout[i - 1], layout[i]] = [layout[i], layout[i - 1]];
        if (a === "down" && i < layout.length - 1) [layout[i + 1], layout[i]] = [layout[i], layout[i + 1]];
        if (a === "x") layout.splice(i, 1);
        touch(); build();
      };
    }
    grid.append(el);
    panelEls.set(p.uid, el.querySelector(".wb-body-in"));
  }
  if (!layout.length) grid.innerHTML = `<p class="wb-muted">This view is empty. Turn on editing and add some panels.</p>`;
  renderAll();
}

function renderAll() {
  if (!doc) return;
  const ctx = { d: doc, slow, alias, setFocus, segments, rain, trace };
  for (const p of layout) {
    const el = panelEls.get(p.uid);
    if (!el) continue;
    try { PANELS[p.type].render(el, { ...ctx, opts: p.opts }); }
    catch (err) { el.innerHTML = `<p class="wb-muted">Panel error: ${esc(err.message)}</p>`; console.error(err); }
  }
}

function setFocus(idx) {
  focusIdx = idx;
  if (ws?.readyState === 1) ws.send(JSON.stringify({ focus: idx }));
}

// ---------- feeds & data ----------
async function loadFeeds() {
  let feeds = [];
  try { feeds = await (await fetch("/api/feeds")).json(); } catch { return; }
  const sel = $("feed");
  const prev = port ?? store.get("port", null) ?? me?.udpPort ?? null;
  sel.innerHTML = feeds.map((f) => `<option value="${f.port}">${esc(alias(f.owner || f.player) || `Port ${f.port}`)}${f.active ? `, ${esc(f.track || "")} (live)` : f.owner ? "" : ` (${f.port})`}</option>`).join("");
  const active = feeds.find((f) => f.active);
  const pick = feeds.some((f) => f.port === prev) ? prev : active?.port ?? feeds[0]?.port;
  if (pick != null) { sel.value = pick; if (pick !== port) connect(pick); }
}
$("feed").onchange = () => { store.set("port", Number($("feed").value)); connect(Number($("feed").value)); };

function connect(p) {
  port = p;
  doc = null; slow = null; focusIdx = -1; trace.points = []; rain.hist = [];
  if (ws) { ws.onclose = null; ws.close(); }
  setStatus("off", "Connecting…");
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/feeds/${p}/workbench`);
  ws.onopen = () => focusIdx >= 0 && ws.send(JSON.stringify({ focus: focusIdx }));
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (doc && d.sessionUid !== doc.sessionUid) { trace.points = []; rain.hist = []; }
    if (d.slow) slow = d.slow;
    doc = d;
    if (d.session) rain.push(d.session.rainNow);
    const stale = d.ageMs > 3000;
    setStatus(stale ? "stale" : "live", stale ? `Last data ${Math.round(d.ageMs / 1000)} s ago` : `Live${d.session ? `, ${d.session.track}, ${d.session.type}` : ""}`);
    $("empty").hidden = true;
    maybeSegments();
    renderAll();
  };
  ws.onclose = () => {
    setStatus("off", "Connection lost, retrying…");
    setTimeout(() => port === p && connect(p), 3000);
  };
}
function setStatus(state, text) { const el = $("status"); el.dataset.state = state; el.textContent = text; }

async function maybeSegments() {
  const track = doc?.session?.trackId;
  if (track == null || !layout.some((p) => p.type === "segments")) return;
  if (segments.track === track && Date.now() - segments.at < 15000) return;
  segments.track = track; segments.at = Date.now();
  try {
    segments.data = await (await fetch(`/api/feeds/${port}/segments?track=${track}`)).json();
    segments.note = `${doc.session.track}, last 12 hours`;
  } catch {}
}

// ---------- aliases ----------
async function loadAliases() { try { aliases = await (await fetch("/api/aliases")).json(); } catch {} }
$("rename").onclick = () => {
  const names = [...new Set([...(doc?.cars || []).map((c) => c.name), ...Object.keys(aliases)].filter(Boolean))].sort();
  $("alias-list").innerHTML = names.length ? names.map((n) => `<label><span>${esc(n)}</span><input data-name="${esc(n)}" value="${esc(aliases[n] || "")}" maxlength="40" placeholder="${esc(n)}"></label>`).join("")
    : `<p class="wb-muted">No drivers yet. They appear while a live session is running.</p>`;
  $("aliases").showModal();
};
$("alias-form").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "save") return;
  const m = {};
  $("alias-list").querySelectorAll("input").forEach((i) => (m[i.dataset.name] = i.value.trim()));
  const res = await fetch("/api/aliases", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(m) });
  if (!res.ok) alert(`Could not save: ${(await res.text()).trim()}`);
  await loadAliases();
  loadFeeds(); renderAll();
});

// ---------- screen ----------
$("hide-nav").onclick = () => {
  const on = !document.body.classList.contains("nav-hidden");
  document.body.classList.toggle("nav-hidden", on);
  $("hide-nav").setAttribute("aria-pressed", on);
  $("hide-nav").textContent = on ? "Show menu" : "Hide menu";
};
$("fullscreen").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
document.addEventListener("fullscreenchange", () => ($("fullscreen").textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen"));
window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });
window.addEventListener("resize", () => renderAll());

await loadAliases();
await loadViews();
loadFeeds();
setInterval(loadFeeds, 10000);
