import React, { useMemo, useState } from "react";
import PeriodFilter, { usePeriodFilter } from "../../components/PeriodFilter";
import { isSaleOrder } from "../../utils/revenue";
import { isOrderStillRunning } from "../../utils/productionMetrics";
import { getOrderChannelLabel } from "../../utils/barcodeService";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";

// ============================================================
// Order Issues tab — Retail Manager (Release 32, client point 5).
// Cancelled / Delayed / Returned / Exchanged / Revoked for the orders this
// dashboard covers (Delhi, Ludhiana, Exhibition, Retail Stock).
//
// How each one is recognised (all on `orders`):
//   Cancelled  status 'cancelled'                       reason: cancellation_reason
//   Revoked    status 'revoked' (brand-initiated cancel) reason: cancellation_reason
//              (there is no revoke_reason column)
//   Returned   status return_store_credit / partial_return / returned
//                                                        reason: return_reason
//   Exchanged  status 'exchange_return'                  reason: exchange_reason
//   Delayed    a sale still in production whose delivery date has passed
//              (same rule as the CEO dashboard). Not a stored status — it is
//              "late right now", so the period filter does not apply to it.
// The period filter uses the date the issue happened (cancelled_at /
// revoked_at / exchange_requested_at), falling back to the order date.
// ============================================================

const rupees = (n) => `₹${formatIndianNumber(Math.round(Number(n) || 0))}`;
const orderValue = (o) => Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0) || 0;
const st = (o) => String(o.status || "").toLowerCase();
const DAY = 86400000;

const KINDS = [
  { key: "cancelled", label: "Cancelled", match: (o) => st(o) === "cancelled", when: (o) => o.cancelled_at, reason: (o) => o.cancellation_reason },
  { key: "delayed", label: "Delayed", match: (o, now) => isSaleOrder(o) && isOrderStillRunning(o) && o.delivery_date && new Date(o.delivery_date).getTime() < now, when: null, reason: (o, now) => lateBucket(o, now) },
  { key: "returned", label: "Returned", match: (o) => ["return_store_credit", "partial_return", "returned"].includes(st(o)), when: (o) => o.exchange_requested_at, reason: (o) => o.return_reason },
  { key: "exchanged", label: "Exchanged", match: (o) => st(o) === "exchange_return", when: (o) => o.exchange_requested_at, reason: (o) => o.exchange_reason },
  { key: "revoked", label: "Revoked", match: (o) => st(o) === "revoked", when: (o) => o.revoked_at || o.cancelled_at, reason: (o) => o.cancellation_reason },
];

function daysLate(o, now) { return Math.max(0, Math.floor((now - new Date(o.delivery_date).getTime()) / DAY)); }
function lateBucket(o, now) {
  const d = daysLate(o, now);
  return d <= 3 ? "1–3 days late" : d <= 7 ? "4–7 days late" : d <= 15 ? "8–15 days late" : "Over 15 days late";
}
const cleanReason = (r) => String(r || "").trim() || "No reason given";

function RankList({ rows, total }) {
  if (!rows.length) return <p className="rm-team-empty">Nothing in this period.</p>;
  return rows.map(([name, n]) => (
    <div key={name} className="rm-issue-rank">
      <span className="rm-issue-rank-name" title={name}>{name}</span>
      <div className="rm-team-bar small"><i style={{ width: `${(n / (rows[0][1] || 1)) * 100}%` }} /></div>
      <b>{n}</b>
      <em>{total ? Math.round((n / total) * 100) : 0}%</em>
    </div>
  ));
}

const countBy = (list, fn) => {
  const m = {};
  list.forEach((o) => { const k = fn(o) || "Unknown"; m[k] = (m[k] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};

export default function RmOrderIssues({ orders, onJourney, busyOrder }) {
  const { inPeriod, props: periodProps } = usePeriodFilter("month", { variant: "pills" });
  const [kind, setKind] = useState("cancelled");
  const now = Date.now();

  const byKind = useMemo(() => {
    const out = {};
    KINDS.forEach((k) => {
      out[k.key] = (orders || []).filter((o) => k.match(o, now) && (!k.when || inPeriod(k.when(o) || o.created_at)));
    });
    return out;
    // `now` changes every render; the list only needs to follow orders + period.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, inPeriod]);

  // Sales placed in the period — the base for "% of orders".
  const salesInPeriod = useMemo(() => (orders || []).filter((o) => inPeriod(o.created_at) && (isSaleOrder(o) || KINDS.some((k) => k.key !== "delayed" && k.match(o)))).length, [orders, inPeriod]);

  const active = KINDS.find((k) => k.key === kind);
  const list = byKind[kind] || [];
  const reasons = countBy(list, (o) => (kind === "delayed" ? active.reason(o, now) : cleanReason(active.reason(o))));
  const byStore = countBy(list, (o) => getOrderChannelLabel(o));
  const bySa = countBy(list, (o) => o.salesperson || "Unknown").slice(0, 10);
  const sorted = [...list].sort((a, b) => kind === "delayed"
    ? daysLate(b, now) - daysLate(a, now)
    : new Date((active.when && active.when(b)) || b.created_at) - new Date((active.when && active.when(a)) || a.created_at));

  return (
    <div className="rm-analytics-tab">
      <div className="rm-tab-header">
        <h2 className="rm-section-title">Order Issues</h2>
        <PeriodFilter {...periodProps} variant="pills" />
      </div>

      <div className="rm-issue-tiles">
        {KINDS.map((k) => {
          const l = byKind[k.key] || [];
          return (
            <button key={k.key} className={`rm-stat-card overview-card rm-issue-tile ${kind === k.key ? "is-active" : ""} is-${k.key}`} onClick={() => setKind(k.key)}>
              <span className="stat-label">{k.label}{k.key === "delayed" ? " (right now)" : ""}</span>
              <span className="stat-value">{l.length}</span>
              <span className="stat-sub">
                {rupees(l.reduce((s, o) => s + orderValue(o), 0))}
                {k.key !== "delayed" && salesInPeriod ? ` · ${((l.length / salesInPeriod) * 100).toFixed(1)}% of orders` : ""}
              </span>
            </button>
          );
        })}
      </div>
      <p className="rm-team-note">
        {kind === "delayed"
          ? "Delayed = a sale still in production whose delivery date has already passed. Counted as of now, whatever the period."
          : `${active.label} in the chosen period, by the date it happened. Value = the order total. Click a tile to see its reasons and orders.`}
      </p>

      <div className="rm-issue-grid">
        <div className="rm-chart-card">
          <h3 className="rm-chart-title">{kind === "delayed" ? "How late" : "Reasons"}</h3>
          <RankList rows={reasons.slice(0, 8)} total={list.length} />
        </div>
        <div className="rm-chart-card">
          <h3 className="rm-chart-title">By store</h3>
          <RankList rows={byStore} total={list.length} />
        </div>
        <div className="rm-chart-card">
          <h3 className="rm-chart-title">By sales associate</h3>
          <RankList rows={bySa} total={list.length} />
        </div>
      </div>

      <h3 className="rm-subsection-title">{active.label} orders ({list.length})</h3>
      <div className="rm-table-wrapper">
        <div className="rm-table-container">
          <table className="rm-table">
            <thead>
              <tr>
                <th>Order ID</th><th>Client</th><th>Product</th><th>Store</th><th>Salesperson</th>
                <th>{kind === "delayed" ? "Delivery date" : "Date"}</th>
                <th>{kind === "delayed" ? "Days late" : "Reason"}</th>
                <th>Value</th><th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? <tr><td colSpan="9" className="rm-no-data">No {active.label.toLowerCase()} orders in this period</td></tr>
                : sorted.slice(0, 200).map((o) => (
                  <tr key={o.id}>
                    <td><span className="rm-order-id">{o.order_no}</span></td>
                    <td>{o.delivery_name || "-"}</td>
                    <td className="rm-product-cell">{o.items?.[0]?.product_name || "-"}</td>
                    <td>{getOrderChannelLabel(o)}</td>
                    <td>{o.salesperson || "-"}</td>
                    <td>{formatDate(kind === "delayed" ? o.delivery_date : (active.when && active.when(o)) || o.created_at)}</td>
                    <td className="rm-issue-reason">{kind === "delayed" ? `${daysLate(o, now)} days` : cleanReason(active.reason(o))}</td>
                    <td>{rupees(orderValue(o))}</td>
                    <td>
                      <button className="rm-action-btn" disabled={!!busyOrder} onClick={() => onJourney(o)}>
                        {busyOrder === `j-${o.id}` ? "Opening…" : "Journey"}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      {sorted.length > 200 && <p className="rm-team-note">Showing the latest 200 of {sorted.length}.</p>}
    </div>
  );
}
