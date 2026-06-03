import React, { useMemo, useState } from "react";
import formatDate from "../../utils/formatDate";

/**
 * CommsOrderCalendar — read-only month calendar plotting comms orders on their
 * delivery_date. Distinct from "My Calendar" (CommsCalendar), which is the
 * user's own editable follow-up/event planner. This view is driven purely by
 * order data — nothing is created or saved here.
 *
 * @param {Array}  orders   comms orders (already filtered to is_comms=true upstream)
 */

// Engagement-type chip color — kept in sync with CommsDashboard.engagementColor.
const engagementColor = (type) => {
  switch (type) {
    case "Barter": return "#1976d2";        // blue
    case "Gifting": return "#2e7d32";       // green
    case "Sourcing": return "#ef6c00";      // orange
    case "Personal order": return "#7b1fa2"; // purple
    default: return "#888";
  }
};

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const isoFromYMD = (year, month, date) =>
  `${year}-${String(month + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`;

// Normalise a stored delivery_date (date or ISO timestamp) to a YYYY-MM-DD key
// in local time, so it lines up with the calendar grid cells.
const dayKey = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function CommsOrderCalendar({ orders }) {
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(todayISO());

  // Index orders by their delivery_date day-key for O(1) cell lookup.
  const ordersByDate = useMemo(() => {
    const map = {};
    (orders || []).forEach((o) => {
      const key = dayKey(o.delivery_date);
      if (!key) return;
      (map[key] ||= []).push(o);
    });
    return map;
  }, [orders]);

  const ordersForSelected = selectedDate ? (ordersByDate[selectedDate] || []) : [];

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;
  const today = todayISO();

  return (
    <>
      <div className="comms-card">
        <div className="comms-overview-header" style={{ marginBottom: 14 }}>
          <h3 className="comms-card-title" style={{ margin: 0 }}>
            Order Calendar
            <span className="comms-card-subtitle">By delivery date</span>
          </h3>
        </div>

        <div className="comms-cal-month">
          <div className="comms-cal-month-header">
            <button
              className="comms-cal-nav-btn"
              onClick={() => setCalendarDate(new Date(year, month - 1, 1))}
            >‹</button>
            <span className="comms-cal-month-label">
              {calendarDate.toLocaleString("default", { month: "long", year: "numeric" })}
            </span>
            <button
              className="comms-cal-nav-btn"
              onClick={() => setCalendarDate(new Date(year, month + 1, 1))}
            >›</button>
          </div>

          <div className="comms-cal-weekrow">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="comms-cal-weekday">{d}</div>
            ))}
          </div>

          <div className="comms-cal-grid">
            {Array.from({ length: totalCells }).map((_, i) => {
              const dateNum = i - firstDayOfMonth + 1;
              if (dateNum <= 0 || dateNum > daysInMonth) {
                return <div key={i} className="comms-cal-cell comms-cal-empty" />;
              }
              const iso = isoFromYMD(year, month, dateNum);
              const dayOrders = ordersByDate[iso] || [];
              const isToday = iso === today;
              const isSelected = iso === selectedDate;
              // Distinct engagement types on this day → one dot each.
              const dotTypes = [...new Set(dayOrders.map((o) => o.comms_engagement_type))];

              return (
                <div
                  key={i}
                  className={`comms-cal-cell ${isToday ? "comms-cal-today" : ""} ${isSelected ? "comms-cal-selected" : ""} ${dayOrders.length > 0 ? "comms-cal-has-events" : ""}`}
                  onClick={() => setSelectedDate(iso)}
                >
                  <span className="comms-cal-cell-num">{dateNum}</span>
                  {dayOrders.length > 0 && (
                    <span className="comms-cal-cell-count">{dayOrders.length}</span>
                  )}
                  {dotTypes.length > 0 && (
                    <div className="comms-cal-cell-dots">
                      {dotTypes.slice(0, 4).map((t) => (
                        <span key={t} className="comms-cal-cell-dot" style={{ background: engagementColor(t) }} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selectedDate && (
        <div className="comms-card">
          <div className="comms-overview-header" style={{ marginBottom: 14 }}>
            <h3 className="comms-card-title" style={{ margin: 0 }}>
              {formatDate(selectedDate)}{selectedDate === today && <span className="comms-cal-today-pill" style={{ marginLeft: 8 }}>Today</span>}
            </h3>
            <span className="comms-muted" style={{ fontSize: 12 }}>
              {ordersForSelected.length} deliver{ordersForSelected.length === 1 ? "y" : "ies"}
            </span>
          </div>

          {ordersForSelected.length === 0 ? (
            <p className="comms-muted">No deliveries scheduled on this day.</p>
          ) : (
            <table className="comms-table">
              <thead>
                <tr>
                  <th>Order No</th>
                  <th>Client</th>
                  <th>Engagement</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {ordersForSelected.map((o) => (
                  <tr key={o.id}>
                    <td><span className="comms-mono">{o.order_no || "—"}</span></td>
                    <td>{o.delivery_name || "—"}</td>
                    <td>
                      <span
                        className="comms-chip"
                        style={{ background: `${engagementColor(o.comms_engagement_type)}1a`, color: engagementColor(o.comms_engagement_type) }}
                      >
                        {o.comms_engagement_type || "—"}
                      </span>
                    </td>
                    <td>{o.status === "pending_approval" ? "Pending Approval" : (o.status || "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
