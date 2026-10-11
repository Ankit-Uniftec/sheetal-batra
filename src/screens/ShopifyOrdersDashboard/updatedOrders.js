// "Updated Orders" (meeting point 46) — orders that just came OUT of Needs
// Review, shown first so they are processed on priority, until their first
// scan.
//
// orders.review_cleared_at is stamped by the database the moment an order
// stops being held (trigger trg_orders_review_cleared,
// db/meeting_points/r5_01_review_cleared_at.sql — its SQL copy of the hold rule
// must stay in step with needsReviewOrder and pay.mjs isPaymentHeld). This file
// only decides what to SHOW from that stamp.

/**
 * Has the order had its first scan? Same signal as the Overview's "In
 * production" count: any piece moved past Order Received. An order with no
 * pieces yet has not been scanned.
 */
export const isFirstScanned = (components) =>
  (components || []).some((c) => c?.current_stage && c.current_stage !== "order_received");

/**
 * Should the order sit in Updated Orders / be pinned on Orders?
 *
 * @param {object}   order
 * @param {object[]} components  the order's pieces
 * @param {{inReview: boolean, cancelled: boolean}} state  from the dashboard's
 *        own predicates, so this never re-implements the hold rule
 */
export const isUpdatedOrder = (order, components, { inReview, cancelled }) =>
  !!order?.review_cleared_at && !inReview && !cancelled && !isFirstScanned(components);

const clearedAt = (o) => new Date(o?.review_cleared_at || 0).getTime() || 0;

/**
 * Updated orders first (most recently cleared first), then every other order in
 * the order it already had. Stable: the caller's sort is kept within each group.
 */
export function pinUpdatedFirst(rows, isUpdated) {
  return rows
    .map((o, i) => ({ o, i, up: isUpdated(o) }))
    .sort((a, b) => (Number(b.up) - Number(a.up)) || (a.up && b.up ? clearedAt(b.o) - clearedAt(a.o) : 0) || (a.i - b.i))
    .map((x) => x.o);
}

/** "just now" / "12 min ago" / "3 h ago" / "2 days ago" for the badge. */
export function clearedAgo(ts, now = Date.now()) {
  const t = new Date(ts).getTime();
  if (!t) return "";
  const mins = Math.max(0, Math.floor((now - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
