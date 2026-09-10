import React, { useMemo, useState } from "react";
import formatDate from "../utils/formatDate";
import { getWarehouseDate, getWarehouseDateObj } from "../utils/warehouseDate";
import { computeDeliveryPerformance, productionFinishedAtByOrder } from "../utils/productionMetrics";
import "./DeliveryPerformancePanel.css";

// Shared "Delivery Performance" panel — the four figures the dispatch desk is
// measured on (client spec, Jul 16):
//   (A) Internal Production Deadline (T-2)   (B) On-time Delivery
//   (C) On-time Production                   (D) Delivery fails
//
// Same contract as ProductionOverview: feed it whatever order set the dashboard
// already holds and it renders identical cards everywhere. All arithmetic lives
// in computeDeliveryPerformance (pure + unit-tested); this file only renders.
//
//   orders      the order set to score (already scoped by the caller)
//   components  pieces for the same scope — production completion is derived
//               from these, since orders.dispatched_at is a dead column.
//   shipments   optional; powers the Delivery Fails card only.

// A rate card. `rate` of null means nothing qualified — show "—", never 0%,
// which would read as total failure rather than "no data yet".
function RateCard({ title, rate, onTime, late, scored, hint, onDrill }) {
  const tone = rate == null ? "" : rate >= 90 ? "dpp-good" : rate >= 75 ? "dpp-warn" : "dpp-bad";
  return (
    <div className={`dpp-card ${tone}`}>
      <p className="dpp-card-title">{title}</p>
      <p className="dpp-card-value">{rate == null ? "—" : `${rate}%`}</p>
      <p className="dpp-card-sub">
        {scored === 0 ? (hint || "Nothing scored yet")
          : <>{onTime} on time · {late} late <span className="dpp-muted">of {scored}</span></>}
      </p>
      {late > 0 && onDrill && (
        <button type="button" className="dpp-drill" onClick={onDrill}>View {late} late</button>
      )}
    </div>
  );
}

export default function DeliveryPerformancePanel({ orders = [], components = [], shipments = [] }) {
  const [drill, setDrill] = useState(null);   // 'production' | 'delivery' | null

  const finishedAt = useMemo(() => productionFinishedAtByOrder(components), [components]);
  const perf = useMemo(
    () => computeDeliveryPerformance(orders, shipments, finishedAt),
    [orders, shipments, finishedAt]
  );

  const drillRows = drill ? perf[drill].orders : [];

  return (
    <div className="dpp-wrap">
      <p className="dpp-heading">Delivery Performance</p>

      <div className="dpp-row">
        <RateCard
          title="On-time Production (T-2)"
          {...perf.production}
          hint="No order has finished production yet"
          onDrill={() => setDrill(drill === "production" ? null : "production")}
        />
        <RateCard
          title="On-time Delivery"
          {...perf.delivery}
          hint="No order delivered yet"
          onDrill={() => setDrill(drill === "delivery" ? null : "delivery")}
        />
        <div className={`dpp-card ${perf.fails.count > 0 ? "dpp-bad" : ""}`}>
          <p className="dpp-card-title">Delivery Fails</p>
          <p className="dpp-card-value">{perf.fails.count}</p>
          <p className="dpp-card-sub">
            {perf.fails.count === 0 ? "No failed or returned shipments" : "failed / returned shipments"}
          </p>
        </div>
      </div>

      {drill && (
        <div className="dpp-drill-panel">
          <div className="dpp-drill-head">
            <span>{drill === "production" ? "Missed the T-2 production deadline" : "Delivered after the promised date"}</span>
            <button type="button" className="dpp-drill-close" onClick={() => setDrill(null)} aria-label="Close">×</button>
          </div>
          {drillRows.length === 0 ? (
            <p className="dpp-empty">Nothing late.</p>
          ) : (
            <div className="dpp-table-scroll">
              <table className="dpp-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>{drill === "production" ? "T-2 Deadline" : "Promised"}</th>
                    <th>{drill === "production" ? "Finished" : "Delivered"}</th>
                    <th>Late by</th>
                  </tr>
                </thead>
                <tbody>
                  {drillRows.map((o) => {
                    const due = drill === "production"
                      ? getWarehouseDateObj(o.delivery_date, o.created_at)
                      : new Date(o.delivery_date);
                    const dueMs = due ? due.getTime() : NaN;
                    const gotMs = drill === "production" ? finishedAt[o.id] : new Date(o.delivered_at).getTime();
                    const days = Number.isFinite(dueMs) && Number.isFinite(gotMs)
                      ? Math.round((gotMs - dueMs) / 86400000) : null;
                    return (
                      <tr key={o.id}>
                        <td>{o.order_no}</td>
                        <td>{drill === "production"
                          ? getWarehouseDate(o.delivery_date, o.created_at)
                          : formatDate(o.delivery_date)}</td>
                        <td>{gotMs ? formatDate(new Date(gotMs)) : "—"}</td>
                        <td className="dpp-late">{days == null ? "—" : `${days}d`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
