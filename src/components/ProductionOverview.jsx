import React, { useMemo } from "react";
import formatIndianNumber from "../utils/formatIndianNumber";
import { computeStatusStats, computeChannelBreakdown, computeProductionMetrics, computeReJourneyCount, countActiveComponents, computeDispatchReady } from "../utils/productionMetrics";
import "./ProductionOverview.css";

// Shared "Production Overview" — the operational metric cards (Total Orders,
// Production Load, Bottlenecks, Delayed, Re-journey %, Dispatch Backlog) plus
// the pipeline breakdown. Feed it whatever order set the dashboard shows; every
// dashboard renders identical cards from the same shared compute.
//
//   orders       the order set to summarise (already scoped by the caller)
//   components   the piece set for the same scope — powers Re-journey % and
//                Dispatch Backlog (both are piece-level). Omit and those two
//                cards read 0 (needs is_rework / is_active / current_stage).
//   showChannel  include the "Orders by Channel" (all channels, stores split) block — only
//                meaningful on the multi-channel Production Manager dashboard.
//   totalLabel   heading for the Total Orders card (default "Total Orders").

const Icon = {
  package: "📦", gear: "⚙️", warning: "⚠️", clock: "⏱️", refresh: "🔄", truck: "🚚", layers: "🧩",
};

function StatCard({ title, value, subtitle, highlight, icon }) {
  return (
    <div className={`po-stat-card ${highlight ? "po-stat-highlight" : ""}`}>
      <div className="po-stat-top">
        {icon && <span className="po-stat-icon" aria-hidden="true">{icon}</span>}
        <p className="po-stat-title">{title}</p>
      </div>
      <div className="po-stat-content">
        <span className="po-stat-value">{value}</span>
        {subtitle && <span className="po-stat-sub">{subtitle}</span>}
      </div>
    </div>
  );
}

function ChannelRow({ label, count, percentage, color }) {
  return (
    <div className="po-channel-row">
      <div className="po-channel-head">
        <span className="po-channel-label">{label}</span>
        <span className="po-channel-count">{count} <span className="po-channel-pct">({percentage}%)</span></span>
      </div>
      <div className="po-channel-track"><div className="po-channel-fill" style={{ width: `${percentage}%`, background: color }} /></div>
    </div>
  );
}

export default function ProductionOverview({ orders = [], components = [], allComponents, showChannel = false, totalLabel = "Total Orders" }) {
  const statusStats = useMemo(() => computeStatusStats(orders), [orders]);
  const channelBreakdown = useMemo(() => computeChannelBreakdown(orders), [orders]);
  // Piece-level signals for the two rewired cards (Re-journey % / Dispatch
  // Backlog). orderById lets computeDispatchReady flag overdue-ready pieces.
  const metrics = useMemo(() => {
    const orderById = {};
    orders.forEach((o) => { orderById[o.id] = o; });
    return computeProductionMetrics(orders, statusStats, {
      reJourneyActive: computeReJourneyCount(components),
      reJourneyDenom: countActiveComponents(components),
      dispatchReady: computeDispatchReady(components, orderById),
    });
  }, [orders, statusStats, components]);

  // Total components CONTAINED IN the shown orders — counted by order membership
  // so it lines up with the Total Orders card (2 orders with 3 + 4 pieces = 7).
  // Uses `allComponents` (the caller's FULL piece set) because `components` is
  // often scan-time-scoped for the stage cards and would undercount. Falls back
  // to `components` when the caller doesn't pass the full set.
  const totalComponents = useMemo(() => {
    const src = Array.isArray(allComponents) ? allComponents : components;
    const ids = new Set(orders.map((o) => o.id));
    return src.reduce((n, c) => n + (ids.has(c.order_id) ? 1 : 0), 0);
  }, [orders, components, allComponents]);

  const pipeline = [
    { label: "Order Received", count: statusStats.orderReceived, cls: "po-dot-pending" },
    { label: "In Production", count: statusStats.inProd, cls: "po-dot-inprod" },
    { label: "Completed", count: statusStats.completed, cls: "po-dot-ready" },
    { label: "Dispatched", count: statusStats.dispatched, cls: "po-dot-dispatched" },
    { label: "Delivered", count: statusStats.delivered, cls: "po-dot-delivered" },
  ];

  return (
    <div className="po-wrap">
      <p className="po-heading">Production Overview</p>

      <div className="po-stats-row">
        <StatCard
          title={totalLabel}
          value={formatIndianNumber(channelBreakdown.total)}
          subtitle={showChannel ? `across ${channelBreakdown.segments.length} channels` : `${statusStats.inProd} in production · ${statusStats.completed} completed`}
          highlight
          icon={Icon.package}
        />
        <StatCard
          title="Total Components"
          value={formatIndianNumber(totalComponents)}
          subtitle={`across ${orders.length} order${orders.length === 1 ? "" : "s"}`}
          icon={Icon.layers}
        />
        <StatCard
          title="Production Load"
          value={`${metrics.productionLoad.percentage}%`}
          subtitle={`${metrics.productionLoad.active} in production`}
          icon={Icon.gear}
        />
        <StatCard
          title="Bottlenecks"
          value={metrics.bottlenecks.count}
          subtitle={metrics.bottlenecks.count > 0 ? `${metrics.bottlenecks.topBottleneck} · ${metrics.bottlenecks.topOverdue} overdue · avg ${metrics.bottlenecks.topAvgDays}d at stage` : "No overdue stages"}
          highlight={metrics.bottlenecks.count > 0}
          icon={Icon.warning}
        />
      </div>

      <div className="po-stats-row">
        <StatCard
          title="Delayed Orders"
          value={metrics.delayed}
          subtitle={`Delay rate: ${metrics.delayRate}%`}
          highlight={metrics.delayed > 0}
          icon={Icon.clock}
        />
        <StatCard
          title="Re-journey %"
          value={`${metrics.rework.percentage}%`}
          subtitle={`${metrics.rework.totalReworks} pieces in rework · ${metrics.rework.trend === "down" ? "↓ Improving" : "↑ Rising"}`}
          icon={Icon.refresh}
        />
        <StatCard
          title="Dispatch Backlog"
          value={metrics.dispatchBacklog.pending}
          subtitle={`${metrics.dispatchBacklog.overdue} overdue · Avg: ${metrics.dispatchBacklog.avgDelay}`}
          highlight={metrics.dispatchBacklog.overdue > 0}
          icon={Icon.truck}
        />
      </div>

      <div className="po-lower">
        {showChannel && (
          <div className="po-channel-card">
            <p className="po-card-title">Orders by Channel</p>
            <div className="po-channel-body">
              {channelBreakdown.segments.map((s) => (
                <ChannelRow key={s.label} label={s.label} count={s.count} percentage={s.pct} color={s.color} />
              ))}
            </div>
          </div>
        )}
        <div className="po-pipeline-card">
          <p className="po-card-title">Production Pipeline</p>
          <div className="po-pipeline-body">
            {pipeline.map(s => (
              <div className="po-pipeline-stage" key={s.label}>
                <div className="po-pipeline-label"><span className={`po-pipeline-dot ${s.cls}`} />{s.label}</div>
                <span className="po-pipeline-count">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
