import { supabase } from "../../lib/supabaseClient";
import { fetchAllRowsParallel } from "../../utils/fetchAllRowsParallel";
import { PM_ORDER_SELECT } from "../../utils/pmOrderColumns";
import {
  STAGE_GROUPS, classifyComponentForStageCard, enrichComponentsWithMovements, getOrderChannelKey, getOrderChannelLabel,
  getStageLabel,
} from "../../utils/barcodeService";

// ============================================================
// The Production Manager's numbers, worked out in ONE place so every page
// agrees. No money and no client contact details are used anywhere here.
//
//   Running order  still being made: not completed, dispatched, delivered,
//                  cancelled, revoked, returned or exchanged.
//   Due date       the warehouse date, T-2 (two days before the client's
//                  delivery date; the real date when the order had less than
//                  two days to run). Read as a LOCAL calendar day.
//   Late           a running order whose due date has passed. Website
//                  (Shopify) and internal stock orders are left out: they are
//                  not promised to a client by a date.
//   Stuck piece    a piece in the warehouse whose time at its current stage
//                  has run past the stage's limit (stage_deadline, set by the
//                  database when the piece is scanned in).
// ============================================================

export const DAY = 86400000;
const two = (n) => String(n).padStart(2, "0");
export const dayKey = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
export const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

/** A date column as a local calendar day (no time zone shift for "2026-11-09"). */
export function localDay(v) {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}
/** Whole days from a to b (b − a), by calendar day. */
export const dayDiff = (a, b) => Math.round((localDay(b) - localDay(a)) / DAY);

const CLOSED = new Set(["completed", "dispatched", "delivered", "cancelled", "revoked", "returned", "exchange_return"]);
export const statusOf = (o) => String(o?.status || "").toLowerCase();
export const isCancelled = (o) => statusOf(o) === "cancelled";
export const isRunning = (o) => !CLOSED.has(statusOf(o)) && o.warehouse_stage !== "dispatched";

const NO_PROMISE = new Set(["shopify", "retail_stock", "b2b_stock", "shopify_stock"]);
/** Orders that carry a promised date for a client (website and stock orders do not). */
export const hasPromise = (o) => !NO_PROMISE.has(getOrderChannelKey(o));
export const channelOf = (o) => getOrderChannelLabel(o) || "Store";
export const isUrgent = (o) => ["urgent", "high"].includes(String(o.priority || "").toLowerCase());

/** The warehouse (T-2) date as a local day. */
export function dueDay(o) {
  const del = localDay(o?.delivery_date);
  if (!del) return null;
  const placed = localDay(o.created_at);
  const d = new Date(del);
  if (placed && Math.floor((del - placed) / DAY) >= 2) d.setDate(d.getDate() - 2);
  return d;
}
/** Days until the due date (negative = days late). null when there is no date. */
export function daysLeft(o, today = todayStart()) {
  const d = dueDay(o);
  return d ? Math.round((d - today) / DAY) : null;
}
export const isLate = (o, today) => isRunning(o) && hasPromise(o) && (daysLeft(o, today) ?? 1) < 0;

// ------------------------------------------------------------ PIECES
const FINISHED = new Set(["production_complete", "packaging_dispatch", "dispatched"]);
const READY = new Set(["production_complete", "packaging_dispatch", "final_qc_passed"]);
export const isFinishedPiece = (c) => FINISHED.has(c.current_stage);
export const isReadyPiece = (c) => READY.has(c.current_stage);
export const isRemovedPiece = (c) => !!c.cancelled_at || c.current_stage === "disposed" || c.current_stage === "scrapped";

// SB WH Delhi (2) is our own second warehouse. A trip there is recorded like a
// vendor trip, but the piece is still with us, so it is never counted as "at a
// vendor" (the same rule Vendor Delays follows).
export const OWN_WH2 = "SB WH Delhi (2)";
export const isWh2Name = (n) => /^sb wh delhi \(2\)$/i.test(String(n || "").trim());
/** A trip to our own SB WH Delhi (2), not to an outside vendor. */
export const isOwnTrip = (m) => !!m?.is_factory2 || isWh2Name(m?.vendor_name);
/** The piece is at SB WH Delhi (2) right now. */
export const atWh2 = (c) => !!c.is_outside_wh && isWh2Name(c.vendor_name);
/** The piece is out with an outside vendor right now. */
export const atVendor = (c) => !!c.is_outside_wh && !isWh2Name(c.vendor_name);

/** Where a piece is: not_started · in_house · at_wh2 · at_vendor · finished · disposed · removed. */
export function pieceState(c) {
  if (c.cancelled_at || c.current_stage === "scrapped") return "removed";
  if (c.current_stage === "disposed") return "disposed";
  if (FINISHED.has(c.current_stage)) return "finished";
  if (c.is_outside_wh) return atWh2(c) ? "at_wh2" : "at_vendor";
  if (c.current_stage === "order_received") return "not_started";
  return "in_house";
}
// ------------------------------------------------------------ ACTIVITY
// Many "running" orders have not moved for weeks: most were made and sent
// without the system being closed, some are forgotten. Separating them keeps
// the live work readable.
export const DORMANT_DAYS = 30;
/** When the piece last moved (its last stage change; its creation when it never moved). */
export const lastMoveAt = (c) => new Date(c.stage_updated_at || c.created_at || 0).getTime();
/** Whole days since the piece last moved. */
export const idleDays = (c, now = Date.now()) => Math.max(0, Math.floor((now - lastMoveAt(c)) / DAY));
/** When anything on the order last moved (the order date when nothing has). */
export function orderLastMove(o, comps = []) {
  const live = comps.filter((c) => !c.cancelled_at);
  const t = live.length ? Math.max(...live.map(lastMoveAt)) : 0;
  return Math.max(t, new Date(o.created_at || 0).getTime());
}
/** A piece counts as stuck when it has not moved for STUCK_DAYS or more. Stage
 *  time limits are mostly one day, so "past the limit" covers nearly every piece
 *  and cannot tell a held-up piece from a busy one; a week without a scan can. */
export const STUCK_DAYS = 7;
export const isStuck = (c, now = Date.now()) => idleDays(c, now) >= STUCK_DAYS;

/** A running order nothing has moved on for DORMANT_DAYS or more. */
export const isDormant = (o, comps, now = Date.now()) => isRunning(o) && (now - orderLastMove(o, comps)) / DAY >= DORMANT_DAYS;

/** A running order promised to a client, due between `from` and `to` days from today (inclusive). */
export function dueIn(o, from, to, today = todayStart()) {
  if (!isRunning(o) || !hasPromise(o)) return false;
  const d = daysLeft(o, today);
  return d != null && d >= from && d <= to;
}

const READY_STAGES = new Set(["final_qc_passed", "production_complete", "packaging_dispatch"]);
const SENT_OR_CLOSED = new Set(["dispatched", "delivered", "cancelled", "revoked", "returned", "exchange_return"]);
/** Orders not yet sent (completed orders included) whose every live piece is made
 *  or already sent, with at least one piece waiting to go out. */
export function readyToDispatch(orders, componentsByOrder, now = Date.now()) {
  const out = [];
  orders.forEach((o) => {
    if (SENT_OR_CLOSED.has(statusOf(o)) || o.warehouse_stage === "dispatched") return;
    const live = (componentsByOrder[o.id] || []).filter((c) => !c.cancelled_at && c.current_stage !== "disposed" && c.current_stage !== "scrapped");
    const waiting = live.filter((c) => READY_STAGES.has(c.current_stage));
    if (!waiting.length || !live.every((c) => READY_STAGES.has(c.current_stage) || c.current_stage === "dispatched")) return;
    const since = Math.max(...waiting.map((c) => new Date(c.stage_updated_at || o.created_at).getTime()));
    out.push({ o, since, waitDays: Math.floor((now - since) / DAY), partial: live.some((c) => c.current_stage === "dispatched") });
  });
  return out.sort((a, b) => a.since - b.since);
}

/** Days a piece has been past its stage limit (0 when within it). */
export function overdueDays(c, now = Date.now()) {
  if (!c.stage_deadline) return 0;
  const t = new Date(c.stage_deadline).getTime();
  return t < now ? Math.max(1, Math.floor((now - t) / DAY)) : 0;
}
/** Days at the current stage. */
export const daysAtStage = (c, now = Date.now()) => (c.stage_updated_at ? Math.floor((now - new Date(c.stage_updated_at).getTime()) / DAY) : null);
export const pieceName = (c) => c.component_label || c.component_type || "Piece";
export const stageName = (c) => getStageLabel(c.current_stage);

/** The stage step a piece counts under on the floor (the stage it went out for, when at a vendor). */
export const floorKey = (c) => classifyComponentForStageCard(c)?.key || null;
export const FLOOR_STEPS = STAGE_GROUPS.filter((g) => g.key !== "order_received" && g.key !== "packaging");

// ------------------------------------------------------------ LOADING
const COMPONENT_COLUMNS = "id, order_id, order_no, barcode, component_type, component_label, current_stage, previous_stage, item_index, is_outside_wh, stage_updated_at, stage_deadline, disposition, disposition_reason, re_journey_count, stage_pass_counts, is_rework, is_active, channel_key, cancelled_at, vendor_name, vendor_exit_at, created_at";
const TYPE_ORDER = { top: 0, bottom: 1, dupatta: 2, extra: 3 };

/** Every order (only the production columns), every piece and the vendor names, side by side. */
export async function loadPmCore() {
  const [ordersRes, compsRes, vendorsRes] = await Promise.all([
    fetchAllRowsParallel("orders", (q) => q.select(PM_ORDER_SELECT).order("created_at", { ascending: false }).order("id")),
    fetchAllRowsParallel("order_components", (q) => q.select(COMPONENT_COLUMNS).order("created_at", { ascending: false }).order("id"))
      .then(async (res) => (res.error ? res : { ...res, data: await enrichComponentsWithMovements(res.data || []) })),
    fetchAllRowsParallel("vendors", (q) => q.select("id, store_brand_name, vendor_code, location").order("id")),
  ]);
  if (ordersRes.error) throw ordersRes.error;
  // An unapproved B2B order is not in production yet (same rule as before).
  const orders = (ordersRes.data || []).filter((o) => !o.is_b2b || o.approval_status === "approved");
  const ids = new Set(orders.map((o) => o.id));
  const components = (compsRes.data || []).filter((c) => ids.has(c.order_id));
  const vendorMap = Object.fromEntries((vendorsRes.data || []).map((v) => [v.id, v]));
  return { orders, components, vendorMap };
}

export function groupPieces(components) {
  const by = {};
  components.forEach((c) => { (by[c.order_id] || (by[c.order_id] = [])).push(c); });
  Object.values(by).forEach((arr) => arr.sort((x, y) => (x.item_index ?? 0) - (y.item_index ?? 0) || (TYPE_ORDER[x.component_type] ?? 9) - (TYPE_ORDER[y.component_type] ?? 9)));
  return by;
}

/** One order's pieces, fresh, after an action on it (instead of reloading everything). */
export async function loadOrderPieces(orderId) {
  const { data, error } = await supabase.from("order_components").select(COMPONENT_COLUMNS).eq("order_id", orderId);
  if (error) throw error;
  return enrichComponentsWithMovements(data || []);
}

/** Scans since a number of days ago (only what the floor pages read). */
export async function loadScans(days) {
  const since = todayStart();
  since.setDate(since.getDate() - (days - 1));
  const res = await fetchAllRowsParallel("stage_transitions", (q) => q
    .select("id, component_id, order_id, order_no, from_stage, to_stage, scanned_by, station_name, transition_type, is_on_time, scanned_at, factory")
    .gte("scanned_at", since.toISOString())
    .order("scanned_at", { ascending: true })
    .order("id"));
  if (res.error) throw res.error;
  return res.data || [];
}

/** Dispatch scans (a piece scanned out at Packaging) since a number of days ago.
 *  This is where a dispatch is recorded: orders.dispatched_at is no longer written. */
export async function loadDispatchScans(days) {
  const since = todayStart();
  since.setDate(since.getDate() - (days - 1));
  const res = await fetchAllRowsParallel("stage_transitions", (q) => q
    .select("id, order_id, component_id, scanned_at")
    .eq("to_stage", "dispatched")
    .gte("scanned_at", since.toISOString())
    .order("scanned_at", { ascending: true })
    .order("id"));
  if (res.error) throw res.error;
  return res.data || [];
}

/** QC checks since a number of days ago. */
export async function loadQc(days) {
  const since = todayStart();
  since.setDate(since.getDate() - (days - 1));
  const res = await fetchAllRowsParallel("qc_records", (q) => q
    .select("id, component_id, order_id, order_no, barcode, result, fail_reason, outcome, rejourney_to_stage, inspected_by, created_at, which_qc, is_override, overridden_by, channel_key")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: true })
    .order("id"));
  if (res.error) throw res.error;
  return res.data || [];
}

/** How many stage-change requests and replacement requests are waiting for a decision. */
export async function loadWaiting() {
  const [req, rep] = await Promise.all([
    supabase.from("stage_change_requests").select("id, request_group, order_id, order_no, requested_at", { count: "exact" }).eq("status", "pending"),
    supabase.from("replacement_requests").select("id, order_id, order_no, created_at", { count: "exact" }).eq("status", "pending"),
  ]);
  const groups = new Set((req.data || []).map((r) => r.request_group || r.id));
  return { requests: groups.size, requestRows: req.data || [], replacements: (rep.data || []).length, replacementRows: rep.data || [] };
}

// ------------------------------------------------------------ SMALL HELPERS
export const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString("en-IN")} ${Number(n) === 1 ? one : many}`;
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
export const avg = (list) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0);
export const median = (list) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** "SB-DLC-0726-003625" → client name, or the B2B brand. */
export const clientOf = (o, vendorMap = {}) => o.delivery_name || (o.is_b2b && vendorMap[o.vendor_id]?.store_brand_name) || "";
export const productsOf = (o) => (o.items || []).map((it) => it.product_name).filter(Boolean).join(", ");
export const piecesQty = (o) => (o.items || []).reduce((s, it) => s + (Number(it.quantity) || 1), 0) || 1;
