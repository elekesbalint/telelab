// Shared active-session picker (SetupLab-style dropdown + LIVE badge).
import { escapeHtml } from "./nav.js";

const KEY = "telelab.port";

export function feedLabel(f) {
  const who = f.owner || f.player || `Port ${f.port}`;
  const track = f.track || "?";
  const type = f.type || "";
  return type ? `${who} ${track} – ${track} – ${type}` : `${who} (${f.port})`;
}

export function loadSavedPort() {
  try { return Number(localStorage.getItem(KEY)) || null; } catch { return null; }
}

export function savePort(port) {
  try { localStorage.setItem(KEY, String(port)); } catch {}
}

/** URL ?port= wins, then the last picked feed, then `fallback`. */
export function preferredFeedPort(fallback = null) {
  const q = Number(new URLSearchParams(location.search).get("port"));
  if (Number.isFinite(q) && q > 0) {
    savePort(q);
    return q;
  }
  return loadSavedPort() ?? fallback;
}

/**
 * Mount a feed picker into `root`. Calls onChange(port) when the user picks one.
 * Returns { setPort, refresh, destroy }.
 */
export function mountFeedPick(root, { onChange, preferredPort = null } = {}) {
  root.classList.add("feed-pick-ui");
  root.innerHTML = `
    <button type="button" class="feed-pick-btn" aria-haspopup="listbox" aria-expanded="false">
      <span class="feed-pick-label">No session</span>
      <span class="feed-pick-chev" aria-hidden="true">▾</span>
    </button>
    <span class="live-pill" hidden>LIVE</span>
    <div class="feed-pick-menu" role="listbox" hidden></div>`;

  const btn = root.querySelector(".feed-pick-btn");
  const label = root.querySelector(".feed-pick-label");
  const pill = root.querySelector(".live-pill");
  const menu = root.querySelector(".feed-pick-menu");
  let feeds = [];
  let port = preferredPort ?? loadSavedPort();
  let open = false;
  let primed = false;

  const close = () => {
    open = false;
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };

  const renderMenu = () => {
    const active = feeds.filter((f) => f.active);
    const rest = feeds.filter((f) => !f.active && (f.owner || f.player));
    const rows = [...active, ...rest];
    const head = active.length
      ? `<p class="feed-pick-head">${active.length} active session${active.length === 1 ? "" : "s"} – select to connect</p>`
      : `<p class="feed-pick-head">No live sessions right now</p>`;
    menu.innerHTML = head + (rows.length
      ? rows.map((f) => `<button type="button" role="option" class="feed-pick-item${f.port === port ? " on" : ""}${f.active ? " live" : ""}" data-port="${f.port}">${escapeHtml(feedLabel(f))}</button>`).join("")
      : `<p class="feed-pick-empty">No feeds configured</p>`);
  };

  const paint = () => {
    const f = feeds.find((x) => x.port === port);
    label.textContent = f ? feedLabel(f) : (port != null ? `Port ${port}` : "No session");
    pill.hidden = !(f && f.active);
    if (open) renderMenu();
  };

  const pick = (p) => {
    port = p;
    savePort(p);
    paint();
    close();
    onChange?.(p);
  };

  btn.onclick = (e) => {
    e.stopPropagation();
    open = !open;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) renderMenu();
  };
  menu.onclick = (e) => {
    const item = e.target.closest("[data-port]");
    if (!item) return;
    pick(Number(item.dataset.port));
  };
  const onDoc = (e) => { if (!root.contains(e.target)) close(); };
  document.addEventListener("click", onDoc);

  async function refresh() {
    try { feeds = await (await fetch("/api/feeds")).json(); } catch { return port; }
    const active = feeds.find((f) => f.active);
    const next = feeds.some((f) => f.port === port) && port != null
      ? port
      : active?.port ?? feeds[0]?.port ?? null;
    const changed = next !== port;
    port = next;
    paint();
    // First resolve must notify even if the saved port did not change,
    // otherwise live pages wait until the user picks the same session again.
    if (port != null && (changed || !primed)) {
      primed = true;
      onChange?.(port);
    }
    return port;
  }

  return {
    getPort: () => port,
    setPort: (p) => { port = p; savePort(p); paint(); onChange?.(p); },
    refresh,
    destroy: () => document.removeEventListener("click", onDoc),
  };
}
