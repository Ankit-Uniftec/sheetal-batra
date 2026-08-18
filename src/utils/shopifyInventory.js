import config from "../config/config";

// ============================================================
// Thin wrapper over the `shopify-inventory` edge function.
//
// That function is DEPLOYED ONLY — its source is not in this repo (see
// supabase/functions/, which has no shopify-inventory directory). Its contract,
// as used by every call site in the app, is exactly two actions:
//
//   { action: "fetch",  product_id }                → { success, inventory: { "S": 3, … } }
//   { action: "reduce", product_id, size, quantity } → { success }
//
// Two things about that contract shape everything built on it:
//
//   1. `reduce` is a RELATIVE DELTA, not an absolute set — a positive quantity
//      reduces stock, a negative one increases it. There is no "set to N"
//      action, so every caller has to read the current value first and compute
//      the difference.
//   2. Sizes are matched by their NAME STRING. `shopify_variant_id` is stored
//      on product_variants but never read at runtime. A size whose name doesn't
//      match Shopify's variant exactly simply never syncs.
//
// `product_id` is the SUPABASE products.id (a UUID) — the edge function looks
// up products.shopify_product_id itself. Passing a Shopify GID here will fail.
//
// These helpers are used by the Add/Edit product form. The 13 pre-existing call
// sites (order placement, cancellation, the dashboards' variant editors)
// deliberately still inline their own fetch — they work, and rewriting
// order-placement inventory logic carries far more risk than it removes.
// ============================================================

const endpoint = () => `${config.SUPABASE_URL}/functions/v1/shopify-inventory`;

const headers = () => ({
  "Content-Type": "application/json",
  apikey: config.SUPABASE_KEY,
  Authorization: `Bearer ${config.SUPABASE_KEY}`,
});

/**
 * Live per-size stock for one product, straight from Shopify.
 *
 * @param   {string} productId  Supabase products.id (UUID), not a Shopify GID.
 * @returns {Promise<Object|null>} `{ "S": 3, "M": 0 }`, or **null** when Shopify
 *          could not be reached or returned a failure.
 *
 * NULL MEANS "UNKNOWN", NEVER "ZERO". Treating an unreachable Shopify as empty
 * stock would zero out a real catalogue — callers must keep their existing
 * numbers and say the value is unverified instead.
 */
export async function fetchShopifyInventory(productId) {
  try {
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ action: "fetch", product_id: productId }),
    });
    const result = await response.json();
    if (result?.success && result.inventory) return result.inventory;
    console.error("Shopify inventory fetch failed:", result?.error);
    return null;
  } catch (err) {
    console.error("Shopify inventory fetch error:", err);
    return null;
  }
}

/**
 * Move one size's Shopify stock by a delta.
 *
 * @param {string} productId  Supabase products.id (UUID).
 * @param {string} size       Size name — must match Shopify's variant exactly.
 * @param {number} delta      Positive REDUCES stock, negative INCREASES it.
 *                            (The edge function only exposes "reduce"; a
 *                            negative quantity is how the whole app raises
 *                            stock — see restoreOrderInventory.js.)
 * @returns {Promise<{ ok: boolean, error?: string }>}
 *
 * To land on an absolute target, the caller computes
 * `delta = currentShopifyQty - desiredQty` — reading `currentShopifyQty` as
 * late as possible, since a sale in between makes the delta wrong.
 */
export async function adjustShopifyInventory(productId, size, delta) {
  if (!delta) return { ok: true };   // nothing to move
  try {
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        action: "reduce",
        product_id: productId,
        size,
        quantity: delta,
      }),
    });
    const result = await response.json();
    if (result?.success) return { ok: true };
    return { ok: false, error: result?.error || "Shopify rejected the update." };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}
