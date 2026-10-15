// Shared shell: icon rail navigation and signed-in user box.
export const ROLE_NAME = { owner: "Owner", engineer: "Engineer", driver: "Driver", pending: "Awaiting approval" };

const LIVE = [
  { href: "/workbench.html", label: "Workbench", icon: "grid" },
  { href: "/", label: "Driver View", match: ["/", "/index.html"], icon: "pulse" },
  { href: "/team-telem.html", label: "Team Telem", icon: "users" },
  { href: "/weather.html", label: "Weather", icon: "cloud" },
  { href: "/connect.html", label: "How to Connect", icon: "plug" },
  { href: "/team.html", label: "Team", icon: "shield" },
];

const REVIEW = [
  { href: "/sessions.html", label: "Sessions", icon: "list" },
  { href: "/tracks.html", label: "Tracks", match: ["/tracks.html", "/track.html"], icon: "route" },
  { href: "/sessions.html", label: "Session Review", match: ["/session.html"], icon: "replay" },
  { href: "/compare.html", label: "Driver Comparison", icon: "compare" },
  { href: "/laps.html", label: "Lap Leaderboard", icon: "bars" },
  { href: "/quali.html", label: "Quali Leaderboard", icon: "stopwatch" },
  { href: "/stints.html", label: "Stint Leaderboard", icon: "layers" },
  { href: "/soon.html?t=Quali%20ERS%20Maps", label: "Quali ERS Maps", soon: true, icon: "bolt" },
  { href: "/soon.html?t=Race%20ERS%20Maps", label: "Race ERS Maps", soon: true, icon: "bolt" },
  { href: "/soon.html?t=Tyre%20Wear%20Maps", label: "Tyre Wear Maps", soon: true, icon: "tyre" },
  { href: "/teamdb.html", label: "Team Database", icon: "db" },
  { href: "/gamedata.html", label: "F1 26 Game Data", icon: "book" },
];

// Stroke icons for the rail (24 x 24, currentColor).
const ICON = {
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.5 4.5 4"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.4A3.3 3.3 0 0 0 7 18z"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  route: '<path d="M5 17c-2-3 0-7 3-8s3-5 7-5 6 4 4 7-6 2-6 6-6 3-8 0z"/>',
  replay: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/><path d="M10.5 9.5v5l4-2.5z"/>',
  compare: '<path d="M7 4v16M17 4v16M3 8l4-4 4 4M13 16l4 4 4-4"/>',
  bars: '<path d="M6 20V11M12 20V5M18 20v-6"/>',
  stopwatch: '<circle cx="12" cy="13" r="7.5"/><path d="M12 13V9.5M10 2.5h4M18.5 6.5l1.5-1.5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  tyre: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/>',
  db: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ""}</svg>`;

export async function loadMe() {
  const res = await fetch("/api/me");
  if (res.status === 401) { location.href = "/login.html"; return null; }
  return res.json();
}

export function avatarUrl(u) {
  if (u.avatar && u.discordId) return `https://cdn.discordapp.com/avatars/${u.discordId}/${u.avatar}.png?size=64`;
  return null;
}

export const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function pathOf(href) {
  try { return new URL(href, location.origin).pathname; } catch { return href; }
}

function isCurrent(item, here) {
  if (item.match) {
    return item.match.some((p) => p === here || (here === "/index.html" && p === "/"));
  }
  try {
    const u = new URL(item.href, location.origin);
    if (u.pathname !== here && !(here === "/index.html" && u.pathname === "/")) return false;
    // For soon.html?t=… highlight only the matching entry.
    if (u.searchParams.has("t")) return u.searchParams.get("t") === new URLSearchParams(location.search).get("t");
    return true;
  } catch {
    return false;
  }
}

function renderGroup(title, items, here) {
  return `<p class="side-label">${title}</p>
    <ul class="side-list">${items.map((item) => {
      const cur = isCurrent(item, here);
      const cls = [cur ? "current" : "", item.soon ? "soon" : ""].filter(Boolean).join(" ");
      return `<li><a class="${cls}" href="${item.href}" aria-label="${escapeHtml(item.label)}${item.soon ? " (coming soon)" : ""}"${cur ? ' aria-current="page"' : ""}>${icon(item.icon)}<span class="lbl">${escapeHtml(item.label)}${item.soon ? '<span class="soon-tag">Soon</span>' : ""}</span></a></li>`;
    }).join("")}</ul>`;
}

/** Build the left sidebar and highlight the current page. */
export async function initNav() {
  document.body.classList.add("has-side");
  const here = location.pathname === "/" ? "/index.html" : location.pathname;
  let side = document.getElementById("side");
  if (!side) {
    side = document.createElement("aside");
    side.id = "side";
    side.className = "side";
    side.setAttribute("aria-label", "Sections");
    document.body.prepend(side);
    const maincol = document.createElement("div");
    maincol.className = "maincol";
    while (side.nextSibling) maincol.append(side.nextSibling);
    document.body.append(maincol);
  }
  side.innerHTML = `
    <a class="side-brand" href="/" aria-label="TeleLab home"><span class="mark" aria-hidden="true"><img src="/logo.png" alt=""></span><span class="word">TeleLab<small>by Bálint Elekes & Tamás Gál</small></span></a>
    <nav class="side-nav">
      ${renderGroup("Live engineering", LIVE, here)}
      ${renderGroup("Data review", REVIEW, here)}
    </nav>`;

  // Drop the old top-nav links if a page still has them.
  for (const a of document.querySelectorAll(".bar .nav a")) {
    if (isCurrent({ href: a.getAttribute("href"), match: a.getAttribute("href") === "/" ? ["/", "/index.html"] : undefined }, here)
      || (here === "/index.html" && a.getAttribute("href") === "/")) {
      a.setAttribute("aria-current", "page");
    }
  }
  const topNav = document.querySelector(".bar .nav");
  if (topNav) topNav.hidden = true;

  if (!document.querySelector('link[rel="icon"]')) {
    const fav = document.createElement("link");
    fav.rel = "icon";
    fav.href = "/logo.png";
    document.head.append(fav);
  }

  const me = await loadMe();
  if (!me) return null;
  const box = document.getElementById("me");
  if (box) {
    const img = avatarUrl(me);
    box.innerHTML = `${img ? `<img src="${img}" alt="">` : ""}<span>${escapeHtml(me.displayName || "")}</span>
      ${me.devMode ? "" : `<form method="post" action="/auth/logout"><button type="submit">Log out</button></form>`}`;
  }
  return me;
}
