// Shared header: highlights the current page and shows the signed-in user.
export const ROLE_NAME = { owner: "Owner", engineer: "Engineer", driver: "Driver", pending: "Awaiting approval" };

export async function loadMe() {
  const res = await fetch("/api/me");
  if (res.status === 401) { location.href = "/login.html"; return null; }
  return res.json();
}

export function avatarUrl(u) {
  if (u.avatar && u.discordId) return `https://cdn.discordapp.com/avatars/${u.discordId}/${u.avatar}.png?size=64`;
  return null;
}

export async function initNav() {
  const here = location.pathname === "/" ? "/index.html" : location.pathname;
  for (const a of document.querySelectorAll(".nav a")) {
    if (a.getAttribute("href") === here || (here === "/index.html" && a.getAttribute("href") === "/")) a.setAttribute("aria-current", "page");
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

export const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
