// ============================================================
// Revenue rule — the single source of truth across all dashboards.
//
// Business rule: an order counts toward revenue the moment it is
// RECEIVED (placed). Its value is subtracted only if the order later
// lands in a cancelled / revoked / returned / refunded state — i.e.
// the money came back or never will.
//
// Import isRevenueOrder everywhere instead of redefining "delivered/
// completed only" locally, so a future change to the rule happens here
// once and propagates to every dashboard.
// ============================================================

// Terminal states that remove an order's value from revenue.
export const REVENUE_EXCLUDED_STATUSES = new Set([
  "cancelled",
  "revoked",
  "return_store_credit",
  "exchange_return",
  "partial_return",
  "refund_requested",
  "returned",
]);

// refund_status values that mean a refund is in progress or done.
export const REFUNDED_STATUSES = new Set([
  "pending",
  "processed",
  "completed",
  "refunded",
]);

/**
 * Does this order count toward revenue?
 * Every received order does, EXCEPT ones cancelled/revoked/returned or
 * with an active refund.
 */
export const isRevenueOrder = (o) => {
  if (!o) return false;
  const status = (o.status || "").toLowerCase();
  if (REVENUE_EXCLUDED_STATUSES.has(status)) return false;
  if (o.refund_status && REFUNDED_STATUSES.has(String(o.refund_status).toLowerCase())) return false;
  return true;
};

/**
 * The rupee value of an order, using the same fallback chain every
 * dashboard already uses (net_total → grand_total_after_discount → grand_total).
 */
export const orderRevenueAmount = (o) =>
  Number(o?.net_total ?? o?.grand_total_after_discount ?? o?.grand_total ?? 0);

// ============================================================
// SALE vs REVENUE — two different questions.
//
// isRevenueOrder answers "did this bring money in?" and is the right filter
// for any SUM of rupees.
//
// isSaleOrder answers "was this a sale at all?" and is the right filter for
// any COUNT of orders, or for an average with a count in the denominator.
// Two kinds of row are real work but are not sales:
//
//   - Internal stock orders (SB-STOCK-, SB-B2BSTOCK-). Moving garments onto a
//     shelf, not selling them. Every one carries 0 in all three money columns.
//   - Alterations (SB-…-A child orders). Rework on a garment already sold and
//     already counted; also 0 in all three money columns.
//
// Because both are 0-value, they never moved a revenue TOTAL — which is why
// this went unnoticed. What they did move is every COUNT and therefore every
// average: 10 real sales worth 10,00,000 plus 5 stock movements reported an
// AOV of 66,667 instead of 1,00,000. Order counts read high, AOV read low.
// ============================================================

/**
 * Was this row an actual sale to a customer?
 * Use for order COUNTS and for the denominator of any average.
 * Use isRevenueOrder (not this) when summing rupees.
 */
export const isSaleOrder = (o) => {
  if (!isRevenueOrder(o)) return false;
  if (o.is_stock_order === true) return false;
  if (o.is_alteration === true) return false;
  return true;
};
