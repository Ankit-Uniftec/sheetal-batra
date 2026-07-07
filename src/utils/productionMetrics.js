// Shared production-operations metrics — the "Production Overview" numbers
// (Total Orders, Production Load, Bottlenecks, Delayed, Rework %, Dispatch
// Backlog, pipeline). Pure functions over an orders array, so every dashboard
// (Production Manager, B2B Production Head, Offline/Online Warehouse PH) can
// compute the same figures scoped to whatever order set it shows.
//
// Extracted verbatim from the Production Manager dashboard so all dashboards
// share ONE implementation and can't drift.

// Order counts by pipeline status.
export function computeStatusStats(list) {
  const pending = list.filter(o => o.status === "pending" || o.status === "order_received" || o.status === "confirmed").length;
  const inProd = list.filter(o => o.status === "prepared" || o.production_status === "in_production").length;
  const dispatched = list.filter(o => o.status === "delivered" || o.production_status === "dispatched").length;
  const readyForDispatch = list.filter(o => o.production_status === "ready_for_dispatch").length;
  return { pending, inProd, dispatched, readyForDispatch };
}

// Channel split (B2B vs Store). Single-channel dashboards can ignore this.
export function computeChannelStats(list) {
  const total = list.length;
  const b2b = list.filter(o => o.is_b2b === true).length;
  const store = total - b2b;
  return {
    total, b2b, store: store > 0 ? store : 0,
    b2bPct: total > 0 ? Math.round((b2b / total) * 100) : 0,
    storePct: total > 0 ? Math.round((store > 0 ? store : 0) / total * 100) : 0,
  };
}

// The full production-operations metric set. `statusStats` must be
// computeStatusStats(orders) for the same list.
export function computeProductionMetrics(orders, statusStats) {
  const now = new Date();
  const activeOrders = orders.filter(o => o.status !== "delivered" && o.status !== "completed" && o.status !== "cancelled");
  const delayed = activeOrders.filter(o => o.delivery_date && new Date(o.delivery_date) < now);
  const reworkOrders = orders.filter(o => o.is_rework);
  const qcFailed = orders.filter(o => o.qc_fail_reason);
  const reworkPct = orders.length > 0 ? ((reworkOrders.length / orders.length) * 100) : 0;
  const qcFailRate = orders.length > 0 ? ((qcFailed.length / orders.length) * 100) : 0;

  // Bottleneck logic — only orders genuinely in the production flow.
  const inFlowOrders = activeOrders.filter(o =>
    o.warehouse_stage || o.status === "confirmed" || o.status === "prepared"
  );

  const stageData = {};
  inFlowOrders.forEach(o => {
    const stage = o.warehouse_stage || o.status || "unknown";
    if (!stageData[stage]) stageData[stage] = { total: 0, overdue: 0, totalOverdueDays: 0 };
    stageData[stage].total++;
    if (o.delivery_date && new Date(o.delivery_date) < now) {
      const days = Math.ceil((now - new Date(o.delivery_date)) / (1000 * 60 * 60 * 24));
      stageData[stage].overdue++;
      stageData[stage].totalOverdueDays += days;
    }
  });

  const stuckByStage = Object.entries(stageData)
    .map(([name, data]) => ({
      name: name.replace(/_/g, " "),
      total: data.total,
      overdue: data.overdue,
      avgOverdueDays: data.overdue > 0 ? Math.round(data.totalOverdueDays / data.overdue) : 0,
      severity: data.overdue > 0 ? "critical" : data.total >= 3 ? "warning" : "normal",
    }))
    .sort((a, b) => b.overdue - a.overdue || b.total - a.total);

  const criticalBottlenecks = stuckByStage.filter(s => s.severity === "critical").length;
  const topBottleneck = stuckByStage[0] || null;

  const readyNotDispatched = orders.filter(o => o.ready_for_dispatch_at && !o.dispatched_at && o.status !== "cancelled");
  const overdueDispatch = readyNotDispatched.filter(o => o.delivery_date && new Date(o.delivery_date) < now);

  return {
    productionLoad: { active: statusStats.inProd, percentage: activeOrders.length > 0 ? Math.round((statusStats.inProd / activeOrders.length) * 100) : 0 },
    bottlenecks: { count: criticalBottlenecks, critical: criticalBottlenecks, topBottleneck: topBottleneck?.name || "None", topOverdue: topBottleneck?.overdue || 0, topAvgDays: topBottleneck?.avgOverdueDays || 0 },
    rework: { percentage: reworkPct.toFixed(1), totalReworks: reworkOrders.length, trend: reworkPct < 5 ? "down" : "up" },
    dispatchBacklog: { pending: readyNotDispatched.length, overdue: overdueDispatch.length, avgDelay: delayed.length > 0 ? `${Math.round(delayed.reduce((s, o) => s + (now - new Date(o.delivery_date)) / (1000 * 60 * 60 * 24), 0) / delayed.length)}d` : "0d" },
    delayed: delayed.length, delayRate: activeOrders.length > 0 ? ((delayed.length / activeOrders.length) * 100).toFixed(1) : "0",
    qcFailed: qcFailed.length, qcFailRate: qcFailRate.toFixed(1), stuckByStage,
    avgLeadTime: (() => { let total = 0, count = 0; orders.forEach(o => { if (o.in_production_at && (o.ready_for_dispatch_at || o.delivered_at)) { const days = (new Date(o.ready_for_dispatch_at || o.delivered_at) - new Date(o.in_production_at)) / (1000 * 60 * 60 * 24); if (days > 0 && days < 365) { total += days; count++; } } }); return count > 0 ? (total / count).toFixed(1) : "0"; })(),
    exceedingDelivery: orders.filter(o => o.status !== "delivered" && o.status !== "completed" && o.status !== "cancelled" && o.delivery_date && new Date(o.delivery_date) < now).sort((a, b) => new Date(a.delivery_date) - new Date(b.delivery_date)),
  };
}
