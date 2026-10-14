// Shared formatting helpers.
export const fmtLap = (ms) => {
  if (!ms) return "–";
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3);
  return m ? `${m}:${s.padStart(6, "0")}` : s;
};
export const fmtDelta = (ms) => (ms == null ? "–" : `${ms >= 0 ? "+" : "−"}${(Math.abs(ms) / 1000).toFixed(3)}`);
export const fmtDate = (iso) => new Date(iso).toLocaleString("hu-HU", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const COMPOUND = { 16: "var(--soft)", 17: "var(--medium)", 18: "var(--hard)", 7: "var(--inter)", 8: "var(--wet)" };
export const COMPOUND_NAME = { 16: "Soft", 17: "Medium", 18: "Hard", 7: "Intermediate", 8: "Esőgumi" };
