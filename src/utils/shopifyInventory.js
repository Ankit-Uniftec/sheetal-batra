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

/**
 * Put a Shopify id into the GID form this database stores.
 *
 * THE STORED SHAPE IS THE FULL GID — verified against the live catalogue, not
 * assumed: 120 of 121 `products.shopify_product_id` and 1000 of 1000
 * `product_variants.shopify_variant_id` rows are `gid://shopify/<Type>/<id>`.
 * (The single exception is the literal string "test" on SKU-1071 — junk, not a
 * bare id.) The deployed `shopify-inventory` edge function therefore consumes
 * GIDs today, so anything written here must match or that product stops syncing.
 *
 * Shopify's URL bar shows only the number while its API and CSV exports hand out
 * the GID, so whichever a user copies is a coin flip. Both are accepted; one
 * shape is stored.
 *
 * Idempotent: a value that is already a GID is returned untouched, so re-saving
 * a product can never produce `gid://shopify/Product/gid://shopify/Product/123`.
 * Mirrors the defensive pattern in supabase/functions/shopify-order-sync
 * (index.ts:1000), which likewise accepts either form rather than assuming one.
 *
 * @param   {string} value  A GID, a bare numeric id, or anything pasted.
 * @param   {"Product"|"ProductVariant"} type  Which GID to build from a bare id.
 * @returns {string} the GID form, or the trimmed input unchanged when it is
 *          neither a GID nor a bare number — never throws, so a typo reaches the
 *          DB as typed rather than being silently blanked or mangled into a
 *          plausible-looking GID that points at nothing.
 */
export function normalizeShopifyId(value, type = "Product") {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  // Already a GID of any type — leave it exactly as-is. Rebuilding it from the
  // trailing digits would silently retype a ProductVariant GID as a Product one.
  if (/^gid:\/\/shopify\/[A-Za-z]+\/\d+$/.test(raw)) return raw;
  // A bare numeric id is the only other thing we can safely interpret.
  if (/^\d+$/.test(raw)) return `gid://shopify/${type}/${raw}`;
  return raw;
}

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
