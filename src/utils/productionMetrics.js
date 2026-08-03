import { getOrderChannelLabel, CHANNEL_SEGMENTS, STAGE_GROUPS, getStageGroupKey } from "./barcodeService";
import { getWarehouseDateObj } from "./warehouseDate";

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

// An order is "still running" (and so can be counted late) only while it has
// not left production. Dispatched counts as done — same rule the dashboards'
// own isOrderRunningLate uses — including the legacy warehouse_stage signal for
// rows whose status was never advanced. Without the warehouse_stage check the
// delayed count silently absorbs every dispatched-but-unstatused order.
const DONE_STATUSES = new Set(["delivered", "completed", "dispatched", "cancelled"]);
export function isOrderStillRunning(o) {
  const s = (o.status || "").toLowerCase();
  return !DONE_STATUSES.has(s) && o.warehouse_stage !== "dispatched";
}

// QC failures from the REAL signal — qc_records rows written by
// record_qc_result. `result` is the literal 'pass' | 'fail'.
//
// Overrides (a PH/PM force-completing a piece without Final QC) carry
// result='pass' only to satisfy the column constraint; nobody inspected the
// garment, so they're excluded from BOTH sides of the fail rate. This mirrors
// qcSummary() in qcHistory.js exactly so the card and the QC History tab agree.
//
// Returns null when no record set was supplied, so the caller can render "—"
// instead of a fabricated 0 that reads as "zero failures".
export function summariseQcFails(records) {
  if (!Array.isArray(records)) return null;
  let fail = 0, inspected = 0;
  records.forEach((r) => {
    if (r.is_override === true) return;      // not an inspection either way
    if (r.result === "fail") fail++;
    inspected++;
  });
  return {
    fail,
    inspected,
    ratePct: inspected > 0 ? Math.round((fail / inspected) * 1000) / 10 : 0,
  };
}

// QC failure reasons, ranked — the breakdown behind the QC Failures count.
// Reads qc_records.fail_reason (what the inspector actually typed at the scan
// station); the old orders.qc_fail_reason column is never written, so any chart
// built on it renders empty forever.
export function qcFailReasonBreakdown(records) {
  if (!Array.isArray(records)) return [];
  const map = {};
  records.forEach((r) => {
    if (r.is_override === true || r.result !== "fail") return;
    const name = (r.fail_reason || "").trim() || "Not specified";
    map[name] = (map[name] || 0) + 1;
  });
  return Object.entries(map)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

// Average production lead time — order placed (orders.created_at) to the piece
// clearing QC (the earliest qc_records row for that order). This is the honest
// reading of "Order to QC": both endpoints are columns the system actually
// writes, unlike the dead in_production_at / ready_for_dispatch_at pair.
//
// Only orders that HAVE reached QC contribute, so the average is over completed
// journeys and isn't dragged down by orders still on the floor. Negative and
// absurd (>365d) spans are dropped as data errors rather than averaged in.
// Returns { avgDays: null } when nothing qualifies — the caller renders "—".
export function computeAvgLeadTime(orders = [], qcRecords) {
  if (!Array.isArray(qcRecords)) return { avgDays: null, sampleSize: 0 };

  // Earliest QC touch per order — the moment production first reached QC.
  const firstQcAt = {};
  qcRecords.forEach((r) => {
    if (!r.order_id || !r.created_at) return;
    const t = new Date(r.created_at).getTime();
    if (!Number.isFinite(t)) return;
    if (firstQcAt[r.order_id] == null || t < firstQcAt[r.order_id]) firstQcAt[r.order_id] = t;
  });

  let total = 0, count = 0;
  orders.forEach((o) => {
    const qcAt = firstQcAt[o.id];
    if (qcAt == null || !o.created_at) return;
    const placedAt = new Date(o.created_at).getTime();
    if (!Number.isFinite(placedAt)) return;
    const days = (qcAt - placedAt) / (1000 * 60 * 60 * 24);
    if (days < 0 || days > 365) return;      // clock skew / bad backfill
    total += days;
    count++;
  });

  return { avgDays: count > 0 ? Number((total / count).toFixed(1)) : null, sampleSize: count };
}

// The production deadline for an order — T-2, the date the WAREHOUSE works to,
// not the customer's promised date. Every other production figure on these
// dashboards uses T-2 (getWarehouseDateObj); the bottleneck table used to use
// the raw delivery_date, so a stage only showed as jammed 2 days after
// production was actually late. One rule, shared.
function productionDueAt(o) {
  return getWarehouseDateObj(o.delivery_date, o.created_at);
}

// Days an order has been sitting at its CURRENT stage. This is the real
// bottleneck signal: "how long has work been parked here", which is what a PM
// acts on. Falls back to created_at for orders that have never been scanned
// (nothing has stamped warehouse_stage_updated_at yet), so a pile of untouched
// Order Received rows still ages honestly.
function daysAtStage(o, now) {
  const since = o.warehouse_stage_updated_at || o.created_at;
  if (!since) return null;
  const t = new Date(since).getTime();
  if (!Number.isFinite(t)) return null;
  const days = (now - t) / 86400000;
  return days >= 0 ? days : null;
}

// Per-stage bottleneck rows for the "Production Stage Bottlenecks" table.
//
// Rewritten — the old version answered a different question than the table
// claimed. Fixes, all of which changed the numbers on screen:
//   * Rows are the 10 STAGE_GROUPS, not raw warehouse_stage values, so
//     "Dyeing In Progress" + "Dyeing Completed" are ONE Dyeing row. The old
//     split showed a single jam as two half-sized ones and mis-ranked them.
//   * Only orders STILL RUNNING count (isOrderStillRunning). Dispatched orders
//     had left production but still showed up as a Critical bottleneck row —
//     and contradicted the Delayed card, which already excluded them.
//   * Overdue is measured against the T-2 warehouse deadline, not the customer
//     delivery date.
//   * avgDaysAtStage measures dwell time at THIS stage (the bottleneck
//     question) instead of days past the deadline (an order-age question that
//     told the PM nothing about where work is stuck).
//
// Each row carries `orderIds` so the table can drill into exactly the orders it
// counted — the UI never has to re-derive the set and can't drift from it.
export function computeStuckByStage(orders = [], now = new Date()) {
  const buckets = {};
  // Seeded in pipeline order so rows read as the flow, and a group with work in
  // it never disappears just because it has no overdue orders.
  STAGE_GROUPS.forEach((g) => {
    buckets[g.key] = {
      key: g.key, label: g.label, step: g.step, color: g.color,
      total: 0, overdue: 0, dwellDays: 0, dwellCount: 0,
      orderIds: [], overdueOrderIds: [],
    };
  });

  orders.forEach((o) => {
    if (!isOrderStillRunning(o)) return;
    // Orders with no scan yet sit in Order Received — getStageGroupKey returns
    // null for that stage by design (order-level callers rely on it), so map it
    // explicitly rather than dropping the row.
    const stage = o.warehouse_stage || "order_received";
    const key = stage === "order_received" ? "order_received" : getStageGroupKey(stage);
    const b = buckets[key];
    if (!b) return;                       // disposed/scrapped/unknown — not a stage in the flow

    b.total++;
    b.orderIds.push(o.id);

    const dwell = daysAtStage(o, now);
    if (dwell != null) { b.dwellDays += dwell; b.dwellCount++; }

    const due = productionDueAt(o);
    if (due && due < now) {
      b.overdue++;
      b.overdueOrderIds.push(o.id);
    }
  });

  return Object.values(buckets)
    .filter((b) => b.total > 0)
    .map((b) => ({
      key: b.key,
      name: b.label,
      color: b.color,
      step: b.step,
      total: b.total,
      overdue: b.overdue,
      // Average time parked at this stage, across every order in it.
      avgDaysAtStage: b.dwellCount > 0 ? Math.round(b.dwellDays / b.dwellCount) : 0,
      overduePct: b.total > 0 ? Math.round((b.overdue / b.total) * 100) : 0,
      orderIds: b.orderIds,
      overdueOrderIds: b.overdueOrderIds,
      // Critical = work here is already past its T-2 deadline. Watch = nothing
      // late yet, but 3+ orders are piling up at this stage.
      severity: b.overdue > 0 ? "critical" : b.total >= 3 ? "warning" : "normal",
    }))
    .sort((a, b) => b.overdue - a.overdue || b.total - a.total);
}

// The full production-operations metric set. `statusStats` must be
// computeStatusStats(orders) for the same list.
//
// `opts` carries the piece-level signals the pure order set can't express:
//   reJourneyActive — live re-journey piece count (computeReJourneyCount)
//   reJourneyDenom  — active-component count for the %; null falls back to
//                     orders.length so callers with no components still work
//   dispatchReady   — { pending, overdue } from computeDispatchReady
//   qcRecords       — qc_records rows (fetchQcRecords) for the same scope; the
//                     ONLY real QC signal. orders.qc_fail_reason is a dead
//                     legacy column no RPC writes, so the old count was
//                     always 0. Overrides are excluded from both sides of the
//                     fail rate by qcSummary — an override is not an inspection.
//   leadTime        — { avgDays, sampleSize } from computeAvgLeadTime; the old
//                     orders.in_production_at / ready_for_dispatch_at path is
//                     equally dead and always read 0.0d.
// Omitting opts yields 0/"—" for those metrics rather than a fabricated number.
export function computeProductionMetrics(orders, statusStats, opts = {}) {
  const now = new Date();
  const activeOrders = orders.filter(o => o.status !== "delivered" && o.status !== "completed" && o.status !== "cancelled");
  // Delay is measured over orders still ON THE FLOOR, so both the count and the
  // rate shrink the moment an order is dispatched.
  const runningOrders = orders.filter(isOrderStillRunning);
  const delayed = runningOrders.filter(o => o.delivery_date && new Date(o.delivery_date) < now);
  const reJourneyActive = opts.reJourneyActive || 0;
  const reJourneyDenom = opts.reJourneyDenom != null ? opts.reJourneyDenom : orders.length;
  const qc = summariseQcFails(opts.qcRecords);
  const leadTime = opts.leadTime || computeAvgLeadTime(orders, opts.qcRecords);
  const reworkPct = reJourneyDenom > 0 ? ((reJourneyActive / reJourneyDenom) * 100) : 0;

  const stuckByStage = computeStuckByStage(orders, now);

  const criticalBottlenecks = stuckByStage.filter(s => s.severity === "critical").length;
  const topBottleneck = stuckByStage[0] || null;

  // Dispatch backlog from the real packaging_dispatch scan signal (see
  // computeDispatchReady). The old orders.ready_for_dispatch_at column is never
  // written, so it always read 0/stray rows.
  const dispatch = opts.dispatchReady || { pending: 0, overdue: 0 };

  return {
    productionLoad: { active: statusStats.inProd, percentage: activeOrders.length > 0 ? Math.round((statusStats.inProd / activeOrders.length) * 100) : 0 },
    // topAvgDays is now dwell time at the top stage ("stuck here N days"), the
    // same figure the bottleneck table's Avg Days at Stage column shows.
    bottlenecks: { count: criticalBottlenecks, critical: criticalBottlenecks, topBottleneck: topBottleneck?.name || "None", topOverdue: topBottleneck?.overdue || 0, topAvgDays: topBottleneck?.avgDaysAtStage || 0 },
    rework: { percentage: reworkPct.toFixed(1), totalReworks: reJourneyActive, trend: reworkPct < 5 ? "down" : "up" },
    dispatchBacklog: { pending: dispatch.pending, overdue: dispatch.overdue, avgDelay: delayed.length > 0 ? `${Math.round(delayed.reduce((s, o) => s + (now - new Date(o.delivery_date)) / (1000 * 60 * 60 * 24), 0) / delayed.length)}d` : "0d" },
    // Delay rate is delayed / still-running (not / activeOrders), so the
    // denominator matches the numerator's population.
    delayed: delayed.length, delayRate: runningOrders.length > 0 ? ((delayed.length / runningOrders.length) * 100).toFixed(1) : "0",
    // qcFailed/avgLeadTime are null when the caller passed no qc_records — the
    // card renders "—" (unknown) rather than a false 0.
    qcFailed: qc ? qc.fail : null,
    qcFailRate: qc ? qc.ratePct.toFixed(1) : null,
    qcInspected: qc ? qc.inspected : 0,
    stuckByStage,
    avgLeadTime: leadTime.avgDays,
    leadTimeSample: leadTime.sampleSize,
    exceedingDelivery: orders.filter(o => isOrderStillRunning(o) && o.delivery_date && new Date(o.delivery_date) < now).sort((a, b) => new Date(a.delivery_date) - new Date(b.delivery_date)),
  };
}
