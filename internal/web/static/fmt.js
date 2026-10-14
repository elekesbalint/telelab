// Shared formatting helpers.
export const fmtLap = (ms) => {
  if (!ms) return "–";
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3);
  return m ? `${m}:${s.padStart(6, "0")}` : s;
};
export const fmtDelta = (ms) => (ms == null ? "–" : `${ms >= 0 ? "+" : "−"}${(Math.abs(ms) / 1000).toFixed(3)}`);
export const fmtDate = (iso) => new Date(iso).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const COMPOUND = { 16: "var(--soft)", 17: "var(--medium)", 18: "var(--hard)", 7: "var(--inter)", 8: "var(--wet)" };
export const COMPOUND_NAME = { 16: "Soft", 17: "Medium", 18: "Hard", 7: "Intermediate", 8: "Wet" };

export const RESULT_NAME = { 0: "–", 1: "Inactive", 2: "Active", 3: "Finished", 4: "DNF", 5: "DSQ", 6: "NC", 7: "Retired" };

const TEAM_HEX = {
  0: "#00d2be", 1: "#e8002d", 2: "#3671c6", 3: "#64c4ff", 4: "#229971",
  5: "#0093cc", 6: "#6692ff", 7: "#b6babd", 8: "#ff8000", 9: "#52e252",
  476: "#00d2be", 477: "#e8002d", 478: "#3671c6", 479: "#64c4ff", 480: "#229971",
  481: "#0093cc", 482: "#6692ff", 483: "#b6babd", 484: "#ff8000", 485: "#f50537", 486: "#d4af37",
};
export const teamColor = (id) => TEAM_HEX[id] || "#9ba1a9";

export const TEAM_NAME_SHORT = {
  0: "Mercedes", 1: "Ferrari", 2: "Red Bull Racing", 3: "Williams", 4: "Aston Martin",
  5: "Alpine", 6: "RB", 7: "Haas", 8: "McLaren", 9: "Sauber",
  476: "Mercedes", 477: "Ferrari", 478: "Red Bull Racing", 479: "Williams", 480: "Aston Martin",
  481: "Alpine", 482: "RB", 483: "Haas", 484: "McLaren", 485: "Audi", 486: "Cadillac",
};
export const teamName = (id) => TEAM_NAME_SHORT[id] || (id ? `#${id}` : "–");
