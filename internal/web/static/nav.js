// Shared shell: sidebar navigation and signed-in user box.
export const ROLE_NAME = { owner: "Owner", engineer: "Engineer", driver: "Driver", pending: "Awaiting approval" };

const LIVE = [
  { href: "/workbench.html", label: "Workbench" },
  { href: "/", label: "Driver View", match: ["/", "/index.html"] },
  { href: "/team-telem.html", label: "Team Telem" },
  { href: "/weather.html", label: "Weather" },
  { href: "/connect.html", label: "How to Connect" },
  { href: "/team.html", label: "Team" },
];

const REVIEW = [
  { href: "/sessions.html", label: "Sessions" },
  { href: "/soon.html?t=Tracks", label: "Tracks", soon: true },
  { href: "/sessions.html", label: "Session Review", match: ["/session.html"] },
  { href: "/compare.html", label: "Driver Comparison" },
  { href: "/soon.html?t=Lap%20Leaderboard", label: "Lap Leaderboard", soon: true },
  { href: "/soon.html?t=Quali%20Leaderboard", label: "Quali Leaderboard", soon: true },
  { href: "/soon.html?t=Stint%20Leaderboard", label: "Stint Leaderboard", soon: true },
  { href: "/soon.html?t=Lap%20Tracker", label: "Lap Tracker", soon: true },
  { href: "/soon.html?t=Quali%20ERS%20Maps", label: "Quali ERS Maps", soon: true },
  { href: "/soon.html?t=Race%20ERS%20Maps", label: "Race ERS Maps", soon: true },
  { href: "/soon.html?t=Tyre%20Wear%20Maps", label: "Tyre Wear Maps", soon: true },
  { href: "/soon.html?t=Team%20Database", label: "Team Database", soon: true },
];

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
      return `<li><a class="${cls}" href="${item.href}"${cur ? ' aria-current="page"' : ""}${item.soon ? ' title="Coming soon"' : ""}>${escapeHtml(item.label)}${item.soon ? '<span class="soon-tag">Soon</span>' : ""}</a></li>`;
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
    <a class="side-brand" href="/">Tele<span>Lab</span><small>by Bálint Elekes</small></a>
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
