import React, { useMemo, useState } from "react";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Month view of what the desk must ship each day (meeting point 34: "Calendar
 * for upcoming orders"). Each day shows how many of the orders currently
 * listed (same tab + filters) have their T-2 dispatch date on it; clicking a
 * day lists exactly those.
 *
 * @param {object[]} orders       the filtered list (without a day filter)
 * @param {(o)=>Date|null} dateOf the order's T-2 date
 * @param {(d)=>string} dayKey    Date → "YYYY-MM-DD"
 * @param {string} selectedDay
 * @param {(key)=>void} onPickDay
 */
export default function DispatchCalendar({ orders, dateOf, dayKey, selectedDay, onPickDay }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  const counts = useMemo(() => {
    const m = {};
    orders.forEach((o) => { const d = dateOf(o); if (d) { const k = dayKey(d); m[k] = (m[k] || 0) + 1; } });
    return m;
  }, [orders, dateOf, dayKey]);

  const todayKey = dayKey(new Date());
  // Monday-first grid: blanks before the 1st, then each day of the month.
  const lead = (month.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  const monthTotal = cells.reduce((n, d) => n + (d ? counts[dayKey(d)] || 0 : 0), 0);
  const shift = (n) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <div className="pkg-cal">
      <div className="pkg-cal-head">
        <button onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <span>
          {month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
          <span className="pkg-muted"> · {monthTotal} order{monthTotal === 1 ? "" : "s"} due (T-2)</span>
        </span>
        <button onClick={() => shift(1)} aria-label="Next month">›</button>
      </div>
      <div className="pkg-cal-grid">
        {WEEKDAYS.map((w) => <div key={w} className="pkg-cal-wd">{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} className="pkg-cal-cell empty" />;
          const k = dayKey(d);
          const n = counts[k] || 0;
          return (
            <button
              key={k}
              className={`pkg-cal-cell ${n ? "has" : ""} ${k === todayKey ? "today" : ""} ${k === selectedDay ? "selected" : ""} ${k < todayKey && n ? "late" : ""}`}
              onClick={() => n && onPickDay(k)}
              disabled={!n}
            >
              <span className="pkg-cal-day">{d.getDate()}</span>
              {n > 0 && <span className="pkg-cal-count">{n}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
