// ============================================================
// Cancellation analytics (open point #4) — for the COO, CEO and Production
// Manager dashboards (components/CancellationsPanel.jsx). Read-only.
//
// A cancelled order = status "cancelled" (a revoke is a different thing and is
// counted separately). Real sales only, the same rule the CEO card uses: stock
// movements and alterations are not customer orders and are left out.
//
// When: orders.cancelled_at (written by every cancel path, the Shopify sync
// included), falling back to updated_at for old rows that predate it.
// Who:  the audit log's changed_by on the status -> cancelled change.
// How far it had got: the furthest production stage any piece reached.
// ============================================================
import { supabase } from "../lib/supabaseClient";
import { fetchAllRowsParallel, runLimited } from "./fetchAllRowsParallel";
import { getOrderChannelLabel } from "./barcodeService";

const ORDER_COLUMNS = [
  "id", "order_no", "status", "created_at", "updated_at", "cancelled_at", "cancellation_reason",
  "net_total", "grand_total_after_discount", "grand_total", "delivery_name", "salesperson",
  "salesperson_store", "is_b2b", "vendor_id", "is_stock_order", "is_alteration", "is_comms",
  "is_private_order", "shopify_order_id", "items", "delivery_date",
].join(",");

// Furthest-stage buckets, in production order.
const BEFORE = new Set(["order_received"]);
const FINISHED = new Set(["production_complete", "packaging_dispatch", "dispatched"]);
export const STAGE_BUCKETS = ["Before production", "In production", "Finished, not delivered", "No pieces"];

export const orderValue = (o) => Number(o?.net_total ?? o?.grand_total_after_discount ?? o?.grand_total ?? 0) || 0;
export const cancelledAtOf = (o) => o?.cancelled_at || o?.updated_at || o?.created_at || null;
export const isSaleCancellation = (o) =>
  String(o?.status || "").toLowerCase() === "cancelled" && !o?.is_stock_order && !o?.is_alteration;

/** Which bucket an order was in when cancelled, from its pieces' stages. */
export function stageBucket(stages = []) {
  const live = stages.filter((s) => s && s !== "disposed" && s !== "scrapped");
  if (live.length === 0) return "No pieces";
  if (live.some((s) => FINISHED.has(s))) return "Finished, not delivered";
  if (live.every((s) => BEFORE.has(s))) return "Before production";
  return "In production";
}

/** A reason in a stable form for grouping (case / spacing / trailing dots ignored). */
export function reasonKey(reason) {
  const r = String(reason || "").trim();
  if (!r) return "No reason given";
  if (/cancel+ed on shopify/i.test(r)) return "Cancelled on Shopify";
  if (/^order_cancelled/i.test(r)) return "Cancelled on Shopify (tag)";
  // Some cancel screens save a code ("Change_in_requirement"): read it as words.
  const clean = r.replace(/_/g, " ").replace(/\s+/g, " ").replace(/[.\s]+$/, "");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

const tally = (rows, keyOf) => {
  const m = new Map();
  rows.forEach((r) => {
    const k = keyOf(r);
    const cur = m.get(k) || { key: k, count: 0, value: 0 };
    cur.count += 1;
    cur.value += r.value;
    m.set(k, cur);
  });
  return [...m.values()].sort((a, b) => b.count - a.count || b.value - a.value);
};

const weekStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Everything the panel shows, from plain rows. Pure.
 * @param {Array} rows    from buildCancellationRows
 * @param {Array} prevRows the same for the previous period of equal length
 * @param {"week"|"month"} grain
 */
export function summariseCancellations(rows = [], prevRows = [], grain = "week") {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const prevTotal = prevRows.reduce((s, r) => s + r.value, 0);
  const trendMap = new Map();
  rows.forEach((r) => {
    const d = new Date(r.cancelledAt);
    if (isNaN(d)) return;
    const k = grain === "month" ? monthKey(d) : weekStart(d).toISOString().slice(0, 10);
    const cur = trendMap.get(k) || { key: k, count: 0, value: 0 };
    cur.count += 1; cur.value += r.value;
    trendMap.set(k, cur);
  });
  return {
    count: rows.length,
    value: total,
    prevCount: prevRows.length,
    prevValue: prevTotal,
    byChannel: tally(rows, (r) => r.channel || "Other"),
    byReason: tally(rows, (r) => r.reasonKey),
    byStage: STAGE_BUCKETS.map((b) => {
      const sel = rows.filter((r) => r.stage === b);
      return { key: b, count: sel.length, value: sel.reduce((s, r) => s + r.value, 0) };
    }).filter((x) => x.count > 0),
    byWho: tally(rows, (r) => r.cancelledBy || "Not recorded"),
    trend: [...trendMap.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** Plain rows from loaded data. Pure. */
export function buildCancellationRows(orders = [], components = [], whoByOrder = {}, vendorNames = {}) {
  const stagesByOrder = components.reduce((m, c) => { (m[c.order_id] = m[c.order_id] || []).push(c.current_stage); return m; }, {});
  return orders.filter(isSaleCancellation).map((o) => ({
    id: o.id,
    orderNo: o.order_no || "",
    channel: getOrderChannelLabel(o) || "Other",
    customer: o.is_b2b && vendorNames[o.vendor_id] ? vendorNames[o.vendor_id] : (o.delivery_name || ""),
    salesperson: o.salesperson || "",
    orderedAt: o.created_at || null,
    cancelledAt: cancelledAtOf(o),
    value: orderValue(o),
    reason: o.cancellation_reason || "",
    reasonKey: reasonKey(o.cancellation_reason),
    stage: stageBucket(stagesByOrder[o.id] || []),
    cancelledBy: whoByOrder[o.id] || "",
    products: (o.items || []).filter((it) => !it?.is_charge).map((it) => it?.product_name).filter(Boolean),
  })).sort((a, b) => String(b.cancelledAt).localeCompare(String(a.cancelledAt)));
}

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

/**
 * Cancelled sales with cancellation time in [fromIso, toIso). Read-only.
 * Orders are found by status, then placed in the period by cancelled_at
 * (falling back to updated_at), so old rows without cancelled_at still count.
 */
export async function fetchCancellations(fromIso, toIso) {
  const { data: all, error } = await fetchAllRowsParallel("orders", (q) => q
    .select(ORDER_COLUMNS)
    .eq("status", "cancelled")
    .order("created_at", { ascending: false })
    .order("id"));
  if (error) throw error;
  const inRange = (all || []).filter((o) => {
    const t = cancelledAtOf(o);
    return t && t >= fromIso && t < toIso;
  });
  if (!inRange.length) return { orders: [], components: [], whoByOrder: {}, vendorNames: {} };

  const idChunks = chunk(inRange.map((o) => o.id), 100);
  const [compRes, auditRes] = await Promise.all([
    runLimited(idChunks.map((ids) => () =>
      supabase.from("order_components").select("order_id, current_stage").in("order_id", ids))),
    runLimited(idChunks.map((ids) => () =>
      supabase.from("audit_log")
        .select("record_id, changed_by, changed_at, new_values")
        .eq("table_name", "orders")
        .contains("changed_fields", ["status"])
        .in("record_id", ids))),
  ]);
  const components = compRes.flatMap((r) => r.data || []);
  // Audit log may not be readable for every role — then "who" stays blank.
  const whoByOrder = {};
  auditRes.flatMap((r) => (r.error ? [] : r.data || []))
    .filter((a) => String(a?.new_values?.status || "").toLowerCase() === "cancelled")
    .sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at)))
    .forEach((a) => { whoByOrder[a.record_id] = a.changed_by || ""; });

  const vendorIds = [...new Set(inRange.filter((o) => o.is_b2b && o.vendor_id).map((o) => o.vendor_id))];
  const vendorNames = {};
  if (vendorIds.length) {
    const { data: vendors } = await supabase.from("vendors").select("id, store_brand_name").in("id", vendorIds);
    (vendors || []).forEach((v) => { vendorNames[v.id] = v.store_brand_name; });
  }
  return { orders: inRange, components, whoByOrder, vendorNames, allCancelled: all || [] };
}
