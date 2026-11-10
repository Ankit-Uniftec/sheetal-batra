import config from "../config/config";
import { supabase } from "../lib/supabaseClient";

// ============================================================
// LXRTS stock on Shopify — the ONE place the app talks to it.
//
// Every call goes to the `shopify-inventory-v2` edge function
// (supabase/functions/shopify-inventory-v2), signed in as the current user.
// Shopify holds the true LXRTS count; product_variants.inventory is the app's
// copy, and the function writes Shopify's new number back after every change.
//
//   fetchShopifyInventory(productId)        read Shopify, refresh the app's copy
//   changeShopifyStock(productId, size, change, { source, orderNo })
//                                           a real movement: + adds, − removes
//   setShopifyStock(productId, size, qty, { source })
//                                           a manual correction to an exact number
//   retryShopifyChange(logId)               send a failed change again
//   loadShopifyStockIssues()                failed / unconfirmed changes
//
// SAFETY: on the local dev server every call is a DRY RUN — the function reads
// Shopify and returns what it would do, but writes nothing to Shopify or the
// database. Only the production build (Vercel) sends real changes. Every
// local copy of this app is connected to the LIVE Shopify store.
//
// `productId` is always the Supabase products.id (a UUID), never a Shopify id.
// ============================================================

export const SHOPIFY_DRY_RUN = process.env.NODE_ENV !== "production";

/**
 * Put a Shopify id into the GID form this database stores.
 *
 * THE STORED SHAPE IS THE FULL GID — verified against the live catalogue:
 * 120 of 121 `products.shopify_product_id` and 1000 of 1000
 * `product_variants.shopify_variant_id` rows are `gid://shopify/<Type>/<id>`.
 * Shopify's URL bar shows only the number while its API and CSV exports hand
 * out the GID, so both are accepted; one shape is stored.
 *
 * Idempotent: a GID is returned untouched. A bare number becomes a GID of
 * `type`. Anything else comes back trimmed and unchanged — never blanked.
 */
export function normalizeShopifyId(value, type = "Product") {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^gid:\/\/shopify\/[A-Za-z]+\/\d+$/.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `gid://shopify/${type}/${raw}`;
  return raw;
}

const endpoint = () => `${config.SUPABASE_URL}/functions/v1/shopify-inventory-v2`;

async function call(body) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, error: "Please sign in again." };
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.SUPABASE_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(SHOPIFY_DRY_RUN && body.action !== "retry" ? { ...body, dry_run: true } : body),
    });
    const result = await response.json().catch(() => ({}));
    if (result?.success) return { ok: true, ...result };
    const err = result?.error;
    return { ok: false, ...result, error: typeof err === "string" ? err : JSON.stringify(err || "Shopify could not be reached.") };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Live per-size stock for one design, straight from Shopify. Also refreshes
 * the app's copy (product_variants) on the way.
 *
 * @returns {Promise<Object|null>} `{ "S": 3, "M": 1 }` (sizes in stock), or
 *          **null** when Shopify could not be read.
 *
 * NULL MEANS "UNKNOWN", NEVER "ZERO". Treating an unreachable Shopify as empty
 * stock would zero out a real catalogue — keep the existing numbers instead.
 */
export async function fetchShopifyInventory(productId) {
  const r = await call({ action: "fetch", product_id: productId });
  if (r.ok && r.inventory) return r.inventory;
  console.error("Shopify inventory fetch failed:", r.error);
  return null;
}

/**
 * A real movement of one size on Shopify (+ adds, − removes): sales,
 * cancellations, receiving. The function reads Shopify's current number and
 * applies the change to it, so a sale on the website at the same moment is
 * never lost.
 *
 * @returns {Promise<{ ok: boolean, error?: string, before?: number, after?: number, dry_run?: boolean }>}
 */
export async function changeShopifyStock(productId, size, change, { source, orderNo } = {}) {
  if (!change) return { ok: true };
  return call({ action: "adjust", product_id: productId, size, change, source: source || "app", order_no: orderNo || undefined });
}

/**
 * Set one size on Shopify to an exact number (manual corrections). Shopify
 * ends at `quantity` whatever the app showed before.
 */
export async function setShopifyStock(productId, size, quantity, { source } = {}) {
  return call({ action: "set", product_id: productId, size, quantity: Number(quantity), source: source || "app" });
}

/** Send a failed change again (inventory / admin / management roles). */
export async function retryShopifyChange(logId) {
  return call({ action: "retry", log_id: logId });
}

/**
 * The old call shape, kept for the Stock Room and the Add/Edit product form:
 * a POSITIVE delta REDUCES stock, a negative one increases it.
 */
export async function adjustShopifyInventory(productId, size, delta, opts = {}) {
  if (!delta) return { ok: true };
  const r = await changeShopifyStock(productId, size, -delta, opts);
  return r.ok ? { ok: true } : { ok: false, error: r.error || "Shopify rejected the update." };
}

/**
 * Changes Shopify refused, or did not confirm, that nobody has retried yet.
 * Newest first.
 */
export async function loadShopifyStockIssues(limit = 200) {
  const { data, error } = await supabase
    .from("shopify_stock_log")
    .select("id, created_at, action, source, order_no, product_id, size, requested_change, requested_quantity, before_qty, delta, status, retryable, error, user_email")
    .in("status", ["failed", "unknown"])
    .is("retried_at", null)
    // Stock Room changes have their own list and retry ("Shopify changes not
    // sent"); listing them here too could send the same change twice.
    .or("source.is.null,source.neq.stock-room")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/** The scheduled sync's last run (null before the tables exist). */
export async function loadShopifySyncState() {
  const { data, error } = await supabase.from("shopify_stock_sync_state").select("*").eq("id", 1).maybeSingle();
  if (error) return null;
  return data;
}
