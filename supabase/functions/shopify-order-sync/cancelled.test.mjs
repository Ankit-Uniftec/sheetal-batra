// Self-check for the Shopify-cancellation guard.
//
// A Shopify cancellation used to reach us as a REFUND on
// shopify_financial_status and nothing else: `cancelledAt` was fetched by every
// mode and read by none. The dashboard saw "no longer awaiting payment" and
// moved the order out of Needs Review INTO the work queue — cancelled, still
// reading "Order Received", barcodes scanning clean.
//
// The guard is two conditions and both matter: a cancelledAt must be present,
// and our own status must not already be cancelled (the hourly refresh sweep
// re-presents the same 24h of orders every run, and an ungated write would
// rewrite the row 24 times a day and fire the orders audit trigger each time).
//
// Run: node supabase/functions/shopify-order-sync/cancelled.test.mjs
import assert from "node:assert/strict";

// Mirrors the guard in refreshExistingOrder (index.ts).
const isNewlyCancelled = (node, existing) => {
  const cancelledAt = node?.cancelledAt || null;
  const alreadyCancelled =
    String(existing?.status || "").trim().toLowerCase() === "cancelled";
  return Boolean(cancelledAt) && !alreadyCancelled;
};

const AT = "2026-08-26T09:15:00Z";

// The bug being fixed: cancelled on Shopify, live on our side.
assert.equal(
  isNewlyCancelled({ cancelledAt: AT }, { status: "order_received" }),
  true
);

// Mid-production cancellations are still cancellations — the floor stops.
assert.equal(
  isNewlyCancelled({ cancelledAt: AT }, { status: "in_production" }),
  true
);

// Second and every later sighting -> no write. This is what keeps the hourly
// sweep from rewriting a settled row (and its audit trail) all day.
assert.equal(
  isNewlyCancelled({ cancelledAt: AT }, { status: "cancelled" }),
  false
);

// Casing/whitespace must not defeat the repeat guard — status is free text
// written by four different in-app cancel paths.
assert.equal(isNewlyCancelled({ cancelledAt: AT }, { status: "Cancelled" }), false);
assert.equal(isNewlyCancelled({ cancelledAt: AT }, { status: " cancelled " }), false);

// A live order: no cancelledAt, nothing to do. The overwhelmingly common case
// on every sweep.
assert.equal(isNewlyCancelled({ cancelledAt: null }, { status: "order_received" }), false);
assert.equal(isNewlyCancelled({}, { status: "order_received" }), false);

// ONE-WAY: Shopify un-cancelled the order (cancelledAt cleared) but we stay
// cancelled. Reviving an order into production costs cloth and machine time and
// is a human's call, never an hourly sweep's.
assert.equal(isNewlyCancelled({ cancelledAt: null }, { status: "cancelled" }), false);

// A brand-new row mid-insert has no status yet; absent must not read as
// cancelled and suppress the write.
assert.equal(isNewlyCancelled({ cancelledAt: AT }, { status: null }), true);
assert.equal(isNewlyCancelled({ cancelledAt: AT }, {}), true);

console.log("cancelled: ok");
