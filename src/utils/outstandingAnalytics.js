import { REVENUE_EXCLUDED_STATUSES, REFUNDED_STATUSES } from "./revenue";

// ============================================================
// Outstanding balances (point #6, Release 28) — one rule for the SA, Store
// Manager, COO and CEO screens, so their numbers can never disagree.
//
// Counted: customer orders still owing money. Not counted: B2B (invoice terms),
// website orders (amounts are not synced), Comms, stock, alterations, and
// cancelled / returned / refunded orders.
//
// Age is days past the DELIVERY DATE on the order: most of the balance sits on
// orders marked completed, which have no delivered date. Orders 60+ days past
// are flagged, because many were collected but never recorded (the client's
// sheet of "balance received" notes, Nov 2026).
// ============================================================

const NOT_CUSTOMER_PREFIXES = new Set(["B2B", "B2BSTOCK", "STOCK", "COM", "SHOPIFY", "SHOP"]);

export const OUTSTANDING_COLUMNS = [
  "id", "user_id", "order_no", "status", "created_at", "delivery_date", "delivery_name", "salesperson", "salesperson_store",
  "net_total", "grand_total_after_discount", "grand_total", "total_paid", "remaining_payment",
  "refund_status", "is_b2b", "is_comms", "is_stock_order", "is_alteration",
].join(", ");

export const AGE_BUCKETS = [
  { key: "not_due", label: "Not yet due" },
  { key: "d0_30", label: "0–30 days" },
  { key: "d31_60", label: "31–60 days" },
  { key: "d60", label: "60+ days" },
];

export const balanceOf = (o) => Math.max(0, Number(o?.remaining_payment) || 0);

/** Is this a customer order that is still owing money? */
export function isOutstanding(o) {
  if (!o || balanceOf(o) <= 0) return false;
  if (o.is_b2b || o.is_comms || o.is_stock_order || o.is_alteration) return false;
  if (NOT_CUSTOMER_PREFIXES.has(String(o.order_no || "").split("-")[1])) return false;
  if (REVENUE_EXCLUDED_STATUSES.has(String(o.status || "").toLowerCase())) return false;
  if (o.refund_status && REFUNDED_STATUSES.has(String(o.refund_status).toLowerCase())) return false;
  return true;
}

/** Whole days past the delivery date (negative = not due). null with no date. */
export function daysPastDelivery(o, today = new Date()) {
  if (!o?.delivery_date) return null;
  const due = new Date(`${String(o.delivery_date).slice(0, 10)}T00:00:00`);
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((now - due) / 86400000);
}

export function ageBucket(days) {
  if (days == null || days < 0) return "not_due";
  if (days <= 30) return "d0_30";
  if (days <= 60) return "d31_60";
  return "d60";
}

const group = (rows, keyOf) => {
  const map = new Map();
  rows.forEach((r) => {
    const key = keyOf(r) || "—";
    const g = map.get(key) || { key, count: 0, value: 0, overdue60: 0 };
    g.count += 1;
    g.value += r.balance;
    if (r.bucket === "d60") g.overdue60 += r.balance;
    map.set(key, g);
  });
  return [...map.values()].sort((a, b) => b.value - a.value);
};

/**
 * @param {object[]} orders any list; only outstanding orders are used
 * @returns {{ rows, count, total, buckets, bySa, byStore }} rows are oldest first
 */
export function buildOutstanding(orders, today = new Date()) {
  const rows = (orders || []).filter(isOutstanding).map((o) => {
    const days = daysPastDelivery(o, today);
    return {
      order: o,
      id: o.id,
      orderNo: o.order_no,
      customer: o.delivery_name || "",
      sa: String(o.salesperson || "").trim(),
      store: String(o.salesperson_store || "").trim(),
      status: o.status || "",
      deliveryDate: o.delivery_date || null,
      days,
      bucket: ageBucket(days),
      total: Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total) || 0,
      paid: Number(o.total_paid) || 0,
      balance: balanceOf(o),
    };
  }).sort((a, b) => (b.days ?? -Infinity) - (a.days ?? -Infinity));

  const buckets = AGE_BUCKETS.map((b) => {
    const mine = rows.filter((r) => r.bucket === b.key);
    return { ...b, count: mine.length, value: mine.reduce((s, r) => s + r.balance, 0) };
  });

  return {
    rows,
    count: rows.length,
    total: rows.reduce((s, r) => s + r.balance, 0),
    buckets,
    bySa: group(rows, (r) => r.sa),
    byStore: group(rows, (r) => r.store),
  };
}
