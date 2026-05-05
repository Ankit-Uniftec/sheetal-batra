import React, { useEffect, useMemo, useState } from "react";
import { fetchAllRows } from "../../utils/fetchAllRows";
import "./StockCalendarTab.css";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const dateKey = (d) => {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt)) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

/**
 * Calendar of stock-order delivery dates.
 *
 * @param {object} props
 * @param {(orderId: string) => void} props.onOpenOrder
 *   Optional. When provided and an order in the day-detail list is clicked,
 *   this callback is invoked with the order id. The parent (InventoryDashboard)
 *   uses this to switch to the "Stock Orders" tab and scroll/highlight the
 *   matching card.
 */
export default function StockCalendarTab({ onOpenOrder }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await fetchAllRows("orders", (q) =>
        q.select("*").eq("is_stock_order", true).order("delivery_date", { ascending: true })
      );
      if (error) {
        console.error("Stock calendar fetch error:", error);
        setOrders([]);
      } else {
        setOrders(data || []);
      }
      setLoading(false);
    })();
  }, []);

  // Bucket orders by their delivery_date (YYYY-MM-DD)
  const ordersByDate = useMemo(() => {
    const m = new Map();
    for (const o of orders) {
      const k = dateKey(o.delivery_date);
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(o);
    }
    return m;
  }, [orders]);

  // Calendar grid
  const grid = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const cells = [];
    // Leading blank cells for offset
    for (let i = 0; i < firstDay.getDay(); i++) cells.push(null);
    for (let d = 1; d <= lastDay.getDate(); d++) cells.push(d);
    return cells;
  }, [year, month]);

  const goPrev = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1);
    setSelectedDay(null);
  };
  const goNext = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1);
    setSelectedDay(null);
  };
  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setSelectedDay(today.getDate());
  };

  const selectedKey = selectedDay
    ? `${year}-${String(month + 1).padStart(2, "0")}-${String(selectedDay).padStart(2, "0")}`
    : null;
  const selectedOrders = selectedKey ? (ordersByDate.get(selectedKey) || []) : [];

  if (loading) return <p className="loading-text">Loading calendar…</p>;

  return (
    <div className="stock-cal">
      <div className="stock-cal-header">
        <button className="stock-cal-nav" onClick={goPrev}>‹</button>
        <h2>{MONTHS[month]} {year}</h2>
        <button className="stock-cal-nav" onClick={goNext}>›</button>
        <button className="stock-cal-today" onClick={goToday}>Today</button>
      </div>

      <div className="stock-cal-grid">
        {DAYS.map((d) => (<div key={d} className="stock-cal-dayhead">{d}</div>))}
        {grid.map((day, idx) => {
          if (day === null) return <div key={`blank-${idx}`} className="stock-cal-cell blank" />;
          const k = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayOrders = ordersByDate.get(k) || [];
          const isToday =
            day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
          const isSelected = day === selectedDay;
          return (
            <div
              key={k}
              className={`stock-cal-cell ${isToday ? "is-today" : ""} ${isSelected ? "is-selected" : ""} ${dayOrders.length > 0 ? "has-orders" : ""}`}
              onClick={() => setSelectedDay(day)}
            >
              <span className="stock-cal-day">{day}</span>
              {dayOrders.length > 0 && (
                <span className="stock-cal-count">{dayOrders.length}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Selected day details */}
      {selectedKey && (
        <div className="stock-cal-detail">
          <h3>
            Stock Orders on {selectedDay} {MONTHS[month]} {year}
            <span className="stock-cal-detail-count">({selectedOrders.length})</span>
          </h3>
          {selectedOrders.length === 0 ? (
            <p className="stock-cal-empty">No deliveries scheduled.</p>
          ) : (
            <ul className="stock-cal-list">
              {selectedOrders.map((o) => (
                <li
                  key={o.id}
                  className={onOpenOrder ? "stock-cal-list-item-clickable" : ""}
                  onClick={() => onOpenOrder && onOpenOrder(o.id)}
                  title={onOpenOrder ? "Open in Stock Orders" : undefined}
                >
                  <div className="stock-cal-listrow">
                    <strong>{o.order_no}</strong>
                    <span className={`stock-cal-status status-${(o.status || "active").toLowerCase()}`}>
                      {o.status || "active"}
                    </span>
                  </div>
                  <div className="stock-cal-listmeta">
                    {o.salesperson || "—"} · {o.mode_of_delivery || "—"} · {(o.items?.length || 0)} item{(o.items?.length || 0) !== 1 ? "s" : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
