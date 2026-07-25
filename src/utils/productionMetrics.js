import { getOrderChannelLabel, CHANNEL_SEGMENTS } from "./barcodeService";

// Shared production-operations metrics — the "Production Overview" numbers
// (Total Orders, Production Load, Bottlenecks, Delayed, Rework %, Dispatch
// Backlog, pipeline). Pure functions over an orders array, so every dashboard
// (Production Manager, B2B Production Head, Offline/Online Warehouse PH) can
// compute the same figures scoped to whatever order set it shows.
//
// Extracted verbatim from the Production Manager dashboard so all dashboards
// share ONE implementation and can't drift.

// Order counts by pipeline stage, from the real signals.
//
// The old version read dead fields (o.status === "prepared", o.production_status)
// that are null/unused on every row — so "In Production" and "Ready" were always
// 0 and "Dispatched" actually counted delivered orders. Now:
//   orderReceived — placed, nothing scanned (warehouse_stage still order_received)
//   inProduction  — a component has moved but the order isn't completed yet
//   completed     — production finished (status = 'completed'), pre-dispatch
//   dispatched    — status = 'dispatched' (Aryadeep's packaging scan; also the
//                   legacy warehouse_stage = 'dispatched')
//   delivered     — status = 'delivered'
export function computeStatusStats(list) {
  const s = (o) => (o.status || "").toLowerCase();
  const orderReceived = list.filter(o => s(o) === "order_received" && (!o.warehouse_stage || o.warehouse_stage === "order_received")).length;
  const completed = list.filter(o => s(o) === "completed").length;
  const dispatched = list.filter(o => s(o) === "dispatched" || o.warehouse_stage === "dispatched").length;
  const delivered = list.filter(o => s(o) === "delivered").length;
  // In production = active (not a terminal state) and past order_received.
  const inProd = list.filter(o => {
    const st = s(o);
    if (["completed", "dispatched", "delivered", "cancelled"].includes(st)) return false;
    return o.warehouse_stage && o.warehouse_stage !== "order_received";
  }).length;
  return { orderReceived, inProd, completed, dispatched, delivered };
}


// Full channel breakdown for "Orders by Channel" — one row per channel with
// the two physical stores split (Delhi / Ludhiana), in the shared segment
// order. Zero-count segments are dropped. Labels/colors come from
// CHANNEL_SEGMENTS so every dashboard's breakdown is identical.
export function computeChannelBreakdown(list = []) {
  const counts = {};
  list.forEach((o) => {
    const label = getOrderChannelLabel(o);
    counts[label] = (counts[label] || 0) + 1;
  });
  const total = list.length;
  const segments = CHANNEL_SEGMENTS
    .filter((s) => counts[s.label] > 0)
    .map((s) => ({
      ...s,
      count: counts[s.label],
      pct: total > 0 ? Math.round((counts[s.label] / total) * 100) : 0,
    }));
  return { total, segments };
}

// Component stages that no longer count as "in re-journey" — a piece has
// cleared production once it reaches one of these, so it drops off the live
// rework count. Mirrors reJourneys.js TERMINAL_STAGES exactly so the Overview
// card and the Re-journeys tab agree.
const REJOURNEY_TERMINAL = new Set([
  "qc_passed", "final_qc_passed", "packaging_dispatch", "dispatched", "disposed", "scrapped",
]);

// Components that no longer count toward the "active" population — the same set
// the "Total Active Components" stage card excludes, so the Re-journey %
// denominator reconciles with that card.
const INACTIVE_COMPONENT_STAGES = new Set(["disposed", "scrapped"]);

// Live re-journey count: pieces sent back to an earlier stage by a QC fail and
// not yet cleared production. is_rework is the DB rework STATE; is_active !==
// false keeps only live pieces; terminal stages are excluded (is_rework is
// never reset). One definition, reused by every dashboard's Re-journey % card.
export function computeReJourneyCount(components = []) {
  return components.filter(c =>
    c.is_rework && c.is_active !== false && !REJOURNEY_TERMINAL.has(c.current_stage)
  ).length;
}

// Active-component population — the Re-journey % denominator (and the stage
// card's grand total): every piece still in the system, disposed/scrapped out.
export function countActiveComponents(components = []) {
  return components.filter(c => !INACTIVE_COMPONENT_STAGES.has(c.current_stage)).length;
}

// Dispatch backlog from the REAL scan signal: pieces sitting at the
// packaging_dispatch stage (ready, not yet dispatch-scanned). overdue = those
// whose order is past its customer delivery date and not cancelled. Replaces
// the dead orders.ready_for_dispatch_at path. `orderById` maps order_id -> order
// so we can check the delivery date for the overdue split.
export function computeDispatchReady(components = [], orderById = {}) {
  const now = new Date();
  const ready = components.filter(c => c.current_stage === "packaging_dispatch");
  const overdue = ready.filter(c => {
    const o = orderById[c.order_id];
    return o && o.delivery_date && new Date(o.delivery_date) < now && o.status !== "cancelled";
  });
  return { pending: ready.length, overdue: overdue.length };
}

// The full production-operations metric set. `statusStats` must be
// computeStatusStats(orders) for the same list.
//
// `opts` carries the piece-level signals the pure order set can't express:
//   reJourneyActive — live re-journey piece count (computeReJourneyCount)
//   reJourneyDenom  — active-component count for the %; null falls back to
//                     orders.length so callers with no components still work
//   dispatchReady   — { pending, overdue } from computeDispatchReady
// Omitting opts yields 0% re-journey / 0 dispatch — a strict improvement over
// the old dead-field values for callers that don't (yet) pass components.
export function computeProductionMetrics(orders, statusStats, opts = {}) {
  const now = new Date();
  const activeOrders = orders.filter(o => o.status !== "delivered" && o.status !== "completed" && o.status !== "cancelled");
  const delayed = activeOrders.filter(o => o.delivery_date && new Date(o.delivery_date) < now);
  const reJourneyActive = opts.reJourneyActive || 0;
  const reJourneyDenom = opts.reJourneyDenom != null ? opts.reJourneyDenom : orders.length;
  const qcFailed = orders.filter(o => o.qc_fail_reason);
  const reworkPct = reJourneyDenom > 0 ? ((reJourneyActive / reJourneyDenom) * 100) : 0;
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

  // Dispatch backlog from the real packaging_dispatch scan signal (see
  // computeDispatchReady). The old orders.ready_for_dispatch_at column is never
  // written, so it always read 0/stray rows.
  const dispatch = opts.dispatchReady || { pending: 0, overdue: 0 };

  return {
    productionLoad: { active: statusStats.inProd, percentage: activeOrders.length > 0 ? Math.round((statusStats.inProd / activeOrders.length) * 100) : 0 },
    bottlenecks: { count: criticalBottlenecks, critical: criticalBottlenecks, topBottleneck: topBottleneck?.name || "None", topOverdue: topBottleneck?.overdue || 0, topAvgDays: topBottleneck?.avgOverdueDays || 0 },
    rework: { percentage: reworkPct.toFixed(1), totalReworks: reJourneyActive, trend: reworkPct < 5 ? "down" : "up" },
    dispatchBacklog: { pending: dispatch.pending, overdue: dispatch.overdue, avgDelay: delayed.length > 0 ? `${Math.round(delayed.reduce((s, o) => s + (now - new Date(o.delivery_date)) / (1000 * 60 * 60 * 24), 0) / delayed.length)}d` : "0d" },
    delayed: delayed.length, delayRate: activeOrders.length > 0 ? ((delayed.length / activeOrders.length) * 100).toFixed(1) : "0",
    qcFailed: qcFailed.length, qcFailRate: qcFailRate.toFixed(1), stuckByStage,
    avgLeadTime: (() => { let total = 0, count = 0; orders.forEach(o => { if (o.in_production_at && (o.ready_for_dispatch_at || o.delivered_at)) { const days = (new Date(o.ready_for_dispatch_at || o.delivered_at) - new Date(o.in_production_at)) / (1000 * 60 * 60 * 24); if (days > 0 && days < 365) { total += days; count++; } } }); return count > 0 ? (total / count).toFixed(1) : "0"; })(),
    exceedingDelivery: orders.filter(o => o.status !== "delivered" && o.status !== "completed" && o.status !== "cancelled" && o.delivery_date && new Date(o.delivery_date) < now).sort((a, b) => new Date(a.delivery_date) - new Date(b.delivery_date)),
  };
}
