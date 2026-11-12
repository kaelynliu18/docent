/** "2026-10-12" → "12 Oct 2026", without timezone drift (dates are calendar days). */
export function formatDay(iso: string, opts: { year?: boolean } = {}) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: opts.year === false ? undefined : "numeric",
    timeZone: "UTC",
  });
}

/** Today's calendar day in the visitor's own timezone, as YYYY-MM-DD. */
export function todayLocal() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
