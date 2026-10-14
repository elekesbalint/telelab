import { escapeHtml } from "./nav.js";

export const SETUP_ROWS = [
  ["Front Wing Aero", "frontWing"],
  ["Rear Wing Aero", "rearWing"],
  ["Diff Adjustment On Throttle", "onThrottle"],
  ["Diff Adjustment Off Throttle", "offThrottle"],
  ["Engine Braking", "engineBraking"],
  ["Front Camber", "frontCamber"],
  ["Rear Camber", "rearCamber"],
  ["Front Toe", "frontToe"],
  ["Rear Toe", "rearToe"],
  ["Front Suspension", "frontSusp"],
  ["Rear Suspension", "rearSusp"],
  ["Front Anti-Roll Bar", "frontARB"],
  ["Rear Anti-Roll Bar", "rearARB"],
  ["Front Ride Height", "frontHeight"],
  ["Rear Ride Height", "rearHeight"],
  ["Brake Pressure", "brakePressure"],
  ["Front Brake Bias", "brakeBias"],
  ["Front Right Tyre Pressure", "pressFR"],
  ["Front Left Tyre Pressure", "pressFL"],
  ["Rear Right Tyre Pressure", "pressRR"],
  ["Rear Left Tyre Pressure", "pressRL"],
];

const DEC = {
  frontCamber: 2, rearCamber: 2, frontToe: 2, rearToe: 2,
  pressFL: 1, pressFR: 1, pressRL: 1, pressRR: 1,
};

export function fmtSetup(v, key) {
  if (v == null || v === "") return "–";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const d = DEC[key];
  if (d != null) return n.toFixed(d);
  return Number.isInteger(n) ? String(n) : String(n);
}

export function shortSessionType(sessionType, typeName) {
  if (sessionType === 15) return "R";
  if (sessionType === 16) return "R2";
  if (sessionType === 17) return "R3";
  return typeName || "";
}

export function setupTitle({ driver, track, type, lap }) {
  const parts = [driver, track, type, lap ? `Lap ${lap}` : ""].filter(Boolean);
  return parts.length ? `Setup — ${parts.join(" · ")}` : "Setup";
}

export function setupTableHtml(su) {
  if (!su) return `<p class="dv-muted">No setup snapshot stored for this session.</p>`;
  return `<table class="su-table"><thead><tr><th>Setting</th><th>Value</th></tr></thead><tbody>${
    SETUP_ROWS.map(([lab, k]) => `<tr><td>${lab}</td><td>${escapeHtml(fmtSetup(su[k], k))}</td></tr>`).join("")
  }</tbody></table>`;
}

export async function openSetupModal(sid, extra = {}) {
  const modal = document.getElementById("modal");
  const title = document.getElementById("modal-title");
  const body = document.getElementById("modal-body");
  if (!modal || !title || !body) return;
  const ses = await (await fetch(`/api/sessions/${sid}`)).then((r) => r.ok ? r.json() : null);
  title.textContent = setupTitle({
    driver: extra.who || ses?.player || "",
    track: extra.track || ses?.track || "",
    type: extra.type || shortSessionType(ses?.sessionType, ses?.type),
    lap: extra.lap || "",
  });
  body.innerHTML = setupTableHtml(ses?.setup);
  modal.hidden = false;
}

export function bindSetupModal(root = document) {
  const modal = document.getElementById("modal");
  const close = document.getElementById("modal-close");
  if (close) close.onclick = () => { modal.hidden = true; };
  if (modal) modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-setup]");
    if (!btn) return;
    e.preventDefault();
    openSetupModal(btn.dataset.setup, {
      who: btn.dataset.who,
      track: btn.dataset.track,
      type: btn.dataset.type,
      lap: btn.dataset.lap,
    });
  });
}
