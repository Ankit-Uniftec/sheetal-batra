import { supabase } from "../../lib/supabaseClient";
import { isProdEnvironment } from "../../utils/appEnvironment";
import { adjustShopifyInventory, fetchShopifyInventory } from "../../utils/shopifyInventory";

// ============================================================
// Stock Room — the ONLY place in the Stock Room allowed to talk to Shopify,
// and the switches that decide whether it may write at all.
//
// Every non-production Supabase project this app has been pointed at so far
// is connected to the LIVE Shopify store. So sending is off unless BOTH:
//   1. the app is on the production database (checked by project ref), and
//   2. REACT_APP_STOCK_ROOM_SHOPIFY_SYNC=on was set for this build.
// With either missing, nothing is sent: each LXRTS change is recorded as
// "not sent" and listed under Integrity, so the logic can be checked without
// touching the store.
//
// Writes to the database follow the same idea one level down: on production
// the Stock Room stays read-only until REACT_APP_STOCK_ROOM_LIVE_WRITES=on.
// A local copy pointed at production for review can never change live stock.
// ============================================================

export const SHOPIFY_SYNC_ON =
  isProdEnvironment && process.env.REACT_APP_STOCK_ROOM_SHOPIFY_SYNC === "on";

export const WRITES_ON =
  !isProdEnvironment || process.env.REACT_APP_STOCK_ROOM_LIVE_WRITES === "on";

// Two finer switches on production, both off unless set for the build:
//   COUNT_CHANGES_ON   Mark sold / Receive / Recount change the EXISTING stock
//                      counts. Off on production (06_production_lock.sql also
//                      revokes them in the database) until counts and Shopify
//                      are linked. Placing and transfers never change counts.
//   PRODUCT_WRITES_ON  Add / edit / import products writes the live catalogue,
//                      which every store sees at once.
export const COUNT_CHANGES_ON =
  WRITES_ON && (!isProdEnvironment || process.env.REACT_APP_STOCK_ROOM_COUNT_CHANGES === "on");

export const PRODUCT_WRITES_ON =
  WRITES_ON && (!isProdEnvironment || process.env.REACT_APP_STOCK_ROOM_PRODUCT_WRITES === "on");

/** Stock actions that change the existing counts, blocked unless COUNT_CHANGES_ON. */
export const COUNT_CHANGING_ACTIONS = ["sell", "receive", "adjust"];

async function markShopify(ids, status, error = null) {
  if (!ids.length) return;
  const { error: rpcError } = await supabase.rpc("stock_room_set_shopify_status", {
    p_ids: ids, p_status: status, p_error: error,
  });
  if (rpcError) console.error("Could not record Shopify status:", rpcError);
}

/**
 * Settle the Shopify side of movements a stock function just returned.
 * Only rows marked "pending" (LXRTS rows that changed the existing count)
 * are considered.
 *
 * @returns {{ sent: number, notSent: number, failed: string[] }}
 */
export async function settleShopify(movements) {
  const pending = (movements || []).filter((m) => m.shopify_status === "pending" && m.legacy_delta);
  if (!pending.length) return { sent: 0, notSent: 0, failed: [] };

  if (!SHOPIFY_SYNC_ON) {
    await markShopify(pending.map((m) => m.id), "not_sent", "Shopify sync is off for this environment");
    return { sent: 0, notSent: pending.length, failed: [] };
  }
  return sendToShopify(pending);
}

/** Try again for rows previously not sent or failed. Production with sync on only. */
export async function retryShopify(movements) {
  if (!SHOPIFY_SYNC_ON) return { sent: 0, notSent: 0, failed: ["Shopify sync is off for this environment."] };
  const rows = (movements || []).filter((m) => ["pending", "not_sent", "failed"].includes(m.shopify_status) && m.legacy_delta);
  return sendToShopify(rows);
}

async function sendToShopify(rows) {
  const sent = [];
  const failed = [];
  // One at a time: the edge function applies a relative change per call, and
  // two changes to the same size must land in order.
  for (const m of rows) {
    // The edge function's "reduce": a positive quantity lowers stock. A sale
    // recorded as legacy_delta -1 therefore sends +1.
    const res = await adjustShopifyInventory(m.product_id, m.size, -m.legacy_delta);
    if (res.ok) {
      sent.push(m.id);
    } else {
      failed.push(`${m.size || "size"}: ${res.error}`);
      await markShopify([m.id], "failed", res.error || "Shopify rejected the change");
    }
  }
  await markShopify(sent, "sent");
  return { sent: sent.length, notSent: 0, failed };
}

/**
 * Shopify's per-size stock for a new LXRTS product, or null when sync is off
 * or Shopify can't be reached (null always means "unknown", never zero).
 */
export async function readShopifyStock(productId) {
  if (!SHOPIFY_SYNC_ON) return null;
  return fetchShopifyInventory(productId);
}
