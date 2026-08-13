import React, { useMemo, useState } from "react";
import formatDate from "../../utils/formatDate";
import "./StoreCalendarTab.css";

/**
 * StoreCalendarTab — read-only month calendar plotting THIS STORE's orders on
 * their delivery_date. Each day shows how many deliveries fall on it; selecting
 * a day lists those orders with their order number and the SA they're assigned
 * to. Driven purely by the store-scoped orders passed in (Delhi or Ludhiana,
 * already filtered by the dashboard) — nothing is created or saved here.
 *
 * @param {Array}    orders      store-scoped orders (have order_no, delivery_date, salesperson)
 * @param {string}   storeLabel  "Delhi" | "Ludhiana" — shown in the header
 * @param {Function} onOpenOrder (orderNo) => void — jump to this order in the Orders tab
 * @param {boolean}  showClient      show the Client column. Default TRUE.
 * @param {boolean}  showSalesperson show the Assigned SA column. Default TRUE.
 * @param {boolean}  showShopifyNo   show the Shopify Order No column. Default FALSE.
 * @param {Function} onDownloadPdf   (e, order) => void. When given, each day row
 *                                   gets an Actions cell with a PDF button.
 * @param {string}   pdfLoadingId    order id whose PDF is currently generating.
 *
 * Both flags default to true so the store dashboards keep their existing
 * columns unchanged. They exist for WAREHOUSE-facing reuse: the Shopify orders
 * dashboard is read by production staff who must not see who bought the
 * garment, and a Shopify order has no human SA (`salesperson` is a constant
 * stand-in), so that column carries no information there either.
 *
 * showShopifyNo / onDownloadPdf are likewise opt-in and default off: only the
 * Shopify screen has a shopify_order_name to show or a warehouse PDF to hand
 * the floor, so the store dashboards render exactly as before.
 *
 * The search box is always on. It filters the SELECTED DAY's rows only — the
 * month grid keeps showing true delivery counts, because a calendar that hid
 * days while you typed would misreport the day's real workload.
 */

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

export default function StoreCalendarTab({
  orders,
  storeLabel,
  onOpenOrder,
  showClient = true,
  showSalesperson = true,
  showShopifyNo = false,
  onDownloadPdf,
  pdfLoadingId,
}) {
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [search, setSearch] = useState("");

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

  // Search the selected day's deliveries. Matches order number and — where the
  // column is shown — the Shopify order no, client and SA, so you only ever
  // search what you can actually see. "#" is stripped so both "#1234" and
  // "1234" find the same Shopify order.
  const norm = (v) => String(v || "").toLowerCase().replace(/#/g, "");
  const query = norm(search).trim();
  const visibleOrders = useMemo(() => {
    if (!query) return ordersForSelected;
    return ordersForSelected.filter((o) => {
      const fields = [o.order_no];
      if (showShopifyNo) fields.push(o.shopify_order_name);
      if (showClient) fields.push(o.delivery_name);
      if (showSalesperson) fields.push(o.salesperson);
      return fields.some((f) => norm(f).includes(query));
    });
  }, [ordersForSelected, query, showShopifyNo, showClient, showSalesperson]);

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;
  const today = todayISO();

  return (
    <div className="scal-wrap">
      <div className="scal-card">
        <div className="scal-card-head">
          <h3 className="scal-card-title">
            Delivery Calendar
            <span className="scal-card-sub">{storeLabel ? `${storeLabel} — by delivery date` : "By delivery date"}</span>
          </h3>
        </div>

        <div className="scal-month">
          <div className="scal-month-head">
            <button className="scal-nav-btn" onClick={() => setCalendarDate(new Date(year, month - 1, 1))}>‹</button>
            <span className="scal-month-label">
              {calendarDate.toLocaleString("default", { month: "long", year: "numeric" })}
            </span>
            <button className="scal-nav-btn" onClick={() => setCalendarDate(new Date(year, month + 1, 1))}>›</button>
          </div>

          <div className="scal-weekrow">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="scal-weekday">{d}</div>
            ))}
          </div>

          <div className="scal-grid">
            {Array.from({ length: totalCells }).map((_, i) => {
              const dateNum = i - firstDayOfMonth + 1;
              if (dateNum <= 0 || dateNum > daysInMonth) {
                return <div key={i} className="scal-cell scal-empty" />;
              }
              const iso = isoFromYMD(year, month, dateNum);
              const dayOrders = ordersByDate[iso] || [];
              const isToday = iso === today;
              const isSelected = iso === selectedDate;

              return (
                <div
                  key={i}
                  className={`scal-cell ${isToday ? "scal-today" : ""} ${isSelected ? "scal-selected" : ""} ${dayOrders.length > 0 ? "scal-has-events" : ""}`}
                  onClick={() => setSelectedDate(iso)}
                >
                  <span className="scal-cell-num">{dateNum}</span>
                  {dayOrders.length > 0 && (
                    <span className="scal-cell-count">{dayOrders.length}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selectedDate && (
        <div className="scal-card">
          <div className="scal-card-head">
            <h3 className="scal-card-title">
              {formatDate(selectedDate)}
              {selectedDate === today && <span className="scal-today-pill">Today</span>}
            </h3>
            <span className="scal-muted">
              {query
                ? `${visibleOrders.length} of ${ordersForSelected.length}`
                : `${ordersForSelected.length} deliver${ordersForSelected.length === 1 ? "y" : "ies"}`}
            </span>
          </div>

          {ordersForSelected.length > 0 && (
            <input
              type="text"
              className="scal-search"
              placeholder={`Search ${["order no", showShopifyNo && "Shopify no", showClient && "client", showSalesperson && "SA"].filter(Boolean).join(", ")}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}

          {ordersForSelected.length === 0 ? (
            <p className="scal-muted">No deliveries scheduled on this day.</p>
          ) : visibleOrders.length === 0 ? (
            <p className="scal-muted">No deliveries on this day match “{search.trim()}”.</p>
          ) : (
            <table className="scal-table">
              <thead>
                <tr>
                  <th>Order No</th>
                  {showShopifyNo && <th>Shopify Order No</th>}
                  {showClient && <th>Client</th>}
                  {showSalesperson && <th>Assigned SA</th>}
                  <th>Status</th>
                  {onDownloadPdf && <th>Warehouse PDF</th>}
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((o) => (
                  <tr
                    key={o.id}
                    className={onOpenOrder ? "scal-row-clickable" : ""}
                    onClick={onOpenOrder ? () => onOpenOrder(o.order_no) : undefined}
                    title={onOpenOrder ? "Open this order in the Orders tab" : undefined}
                  >
                    <td><span className="scal-mono scal-order-link">{o.order_no || "—"}</span></td>
                    {showShopifyNo && <td><span className="scal-mono">{o.shopify_order_name || "—"}</span></td>}
                    {showClient && <td>{o.delivery_name || "—"}</td>}
                    {showSalesperson && <td>{o.salesperson || "—"}</td>}
                    <td>{o.status === "pending_approval" ? "Pending Approval" : (o.status || "—")}</td>
                    {onDownloadPdf && (
                      // stopPropagation: the row itself may be a click-to-open
                      // target, and downloading a PDF must not also navigate.
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          className="scal-pdf-btn"
                          onClick={(e) => onDownloadPdf(e, o)}
                          disabled={pdfLoadingId === o.id}
                        >
                          {pdfLoadingId === o.id ? "…" : "PDF"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
