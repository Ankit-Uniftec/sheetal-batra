// ============================================================
// The one date range the header button sets. Quality, Vendors, Dispatch &
// Delivery and People all report on it, so changing it once changes every
// page. Days are local calendar days; "Last 7 Days" is today and the six
// days before it.
// ============================================================
import { DAY, fmtDate, todayStart } from "./pmModel";

export const PM_PERIODS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "90d", label: "Last 90 Days" },
  { value: "month", label: "This Month" },
  { value: "lastmonth", label: "Last Month" },
  { value: "year", label: "This Year" },
  { value: "custom", label: "Choose Dates" },
];
export const DEFAULT_PERIOD = "30d";

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayOf = (key) => { const [y, m, d] = String(key).split("-").map(Number); return y ? new Date(y, m - 1, d) : null; };
const span = (a, b) => Math.round((b - a) / DAY);

/**
 * The range for a choice: start (first day, 00:00) and end (the day after the
 * last day, 00:00), so a time t is inside when start <= t < end.
 * prev is the same number of days just before, for comparisons.
 */
export function pmPeriod(key, from, to) {
  const today = todayStart();
  const tomorrow = addDays(today, 1);
  let start; let end = tomorrow;
  switch (key) {
    case "today": start = today; break;
    case "yesterday": start = addDays(today, -1); end = today; break;
    case "7d": start = addDays(today, -6); break;
    case "90d": start = addDays(today, -89); break;
    case "month": start = new Date(today.getFullYear(), today.getMonth(), 1); break;
    case "lastmonth": start = new Date(today.getFullYear(), today.getMonth() - 1, 1); end = new Date(today.getFullYear(), today.getMonth(), 1); break;
    case "year": start = new Date(today.getFullYear(), 0, 1); break;
    case "custom": {
      const a = dayOf(from);
      if (!a) return pmPeriod(DEFAULT_PERIOD);
      const b = dayOf(to) || a;
      start = a < b ? a : b;
      end = addDays(a < b ? b : a, 1);
      if (end > tomorrow) end = tomorrow;
      break;
    }
    default: key = "30d"; start = addDays(today, -29);
  }
  const days = Math.max(1, span(start, end));
  const prevStart = addDays(start, -days);
  const last = addDays(end, -1);
  const label = key === "custom"
    ? (days === 1 ? fmtDate(start) : `${fmtDate(start)} to ${fmtDate(last)}`)
    : PM_PERIODS.find((p) => p.value === key).label;
  const s = start.getTime(); const e = end.getTime();
  return {
    key, label, start, end, days,
    // The dates in words, for card subtitles: "01 - 11 - 2026 to 09 - 11 - 2026".
    dates: days === 1 ? fmtDate(start) : `${fmtDate(start)} to ${fmtDate(last)}`,
    inP: (ts) => { if (!ts) return false; const t = new Date(ts).getTime(); return t >= s && t < e; },
    prev: { start: prevStart, end: start, inP: (ts) => { if (!ts) return false; const t = new Date(ts).getTime(); return t >= prevStart.getTime() && t < s; } },
    // How many days back from today the data must reach to cover this range and the one before it.
    reach: span(prevStart, tomorrow),
    // How many days back from today the data must reach to cover this range alone.
    back: span(start, tomorrow),
  };
}

// The data sets come in a few fixed lengths so most choices reuse one load.
const SIZES = { scans: [8, 30, 90, 180, 400], qc: [8, 90, 180, 400], dispatch: [120, 400] };
/** The lazy-loader key that covers this many days back, e.g. ("qc", 60) -> "qc90". */
export function coverKey(kind, days) {
  const n = SIZES[kind].find((s) => s >= days) || Math.ceil(days);
  return `${kind}${n}`;
}

/** Chart steps across the range: days up to a month, weeks up to about four months, then months. */
export function periodSteps(p) {
  const out = [];
  const step = p.days <= 31 ? "day" : p.days <= 120 ? "week" : "month";
  let s = new Date(p.start);
  while (s < p.end) {
    let next;
    if (step === "day") next = addDays(s, 1);
    else if (step === "week") next = addDays(s, 7);
    else next = new Date(s.getFullYear(), s.getMonth() + 1, 1);
    if (next > p.end) next = new Date(p.end);
    out.push({
      from: new Date(s), to: next,
      name: step === "month" ? s.toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
        : step === "day" && p.days <= 7 ? s.toLocaleDateString("en-GB", { weekday: "short" })
          : s.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      full: step === "day" ? fmtDate(s) : step === "week" ? `Week from ${fmtDate(s)}` : s.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    });
    s = next;
  }
  return { step, steps: out };
}

/** Index of the step a time falls in, or -1. */
export function stepOf(steps, ts) {
  const t = new Date(ts).getTime();
  for (let i = 0; i < steps.length; i += 1) if (t >= steps[i].from.getTime() && t < steps[i].to.getTime()) return i;
  return -1;
}
