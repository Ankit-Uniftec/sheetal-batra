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

// Mirrors shopifyCancellation + the guard in refreshExistingOrder (index.ts).
const CANCEL_TAG_RE = /^order_cancelled\b/i;
const shopifyCancellation = (cancelledAt, tags) => {
  if (cancelledAt) return { at: cancelledAt, reason: "Cancelled on Shopify" };
  const tag = (Array.isArray(tags) ? tags : [])
    .map((t) => String(t).trim())
    .find((t) => CANCEL_TAG_RE.test(t));
  if (tag) return { at: new Date().toISOString(), reason: `Cancelled on Shopify (tag: ${tag})` };
  return null;
};
const isNewlyCancelled = (node, existing) => {
  const alreadyCancelled =
    String(existing?.status || "").trim().toLowerCase() === "cancelled";
  return Boolean(shopifyCancellation(node?.cancelledAt, node?.tags)) && !alreadyCancelled;
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

// Cancelled by TAG only (#29303): COD verification tags "order_cancelled(OL)"
// and never presses Cancel, so cancelledAt is null.
const TAGS_29303 = ["1st call attempted", "COD", "GoKwik", "Low Risk", "Not Converted To Prepaid", "order_cancelled(OL)"];
assert.equal(isNewlyCancelled({ cancelledAt: null, tags: TAGS_29303 }, { status: "order_received" }), true);
assert.equal(shopifyCancellation(null, TAGS_29303).reason, "Cancelled on Shopify (tag: order_cancelled(OL))");
assert.equal(isNewlyCancelled({ tags: ["ORDER_CANCELLED"] }, { status: "order_received" }), true);
assert.equal(isNewlyCancelled({ tags: ["order_cancelled(OL)"] }, { status: "cancelled" }), false);
// Real cancelledAt wins over the tag — it carries the true timestamp.
assert.equal(shopifyCancellation(AT, ["order_cancelled(OL)"]).at, AT);
// Look-alikes must NOT cancel a live order.
for (const t of ["COD", "Not Converted To Prepaid", "order_cancelled_reverted", "not order_cancelled", "cancelled"]) {
  assert.equal(shopifyCancellation(null, [t]), null, t);
}

console.log("cancelled: ok");
