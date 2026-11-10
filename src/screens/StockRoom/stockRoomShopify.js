import { supabase } from "../../lib/supabaseClient";
import { isProdEnvironment } from "../../utils/appEnvironment";
import { adjustShopifyInventory, fetchShopifyInventory, loadShopifySyncState, setShopifyStock } from "../../utils/shopifyInventory";

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
export async function settleShopify(movements, exact = {}) {
  const pending = (movements || []).filter((m) => m.shopify_status === "pending" && m.legacy_delta);
  if (!pending.length) return { sent: 0, notSent: 0, failed: [] };

  if (!SHOPIFY_SYNC_ON) {
    await markShopify(pending.map((m) => m.id), "not_sent", "Shopify sync is off for this environment");
    return { sent: 0, notSent: pending.length, failed: [] };
  }
  return sendToShopify(pending, exact);
}

const sizeKey = (productId, size) => `${productId}|${String(size || "").trim().toLowerCase()}`;

/**
 * Exact Shopify targets for a stock action. Only a FULL recount (no location)
 * is a count of the whole size, so only it sets Shopify to the counted number;
 * a recount of one location, a sale and a receipt are movements and are sent
 * as changes. Returns { "<product>|<size>": counted } or {}.
 */
export function exactTargets({ mode, locationId, productId, size, counted }) {
  if (mode !== "adjust" || locationId || !productId) return {};
  const n = Number(counted);
  return Number.isInteger(n) && n >= 0 ? { [sizeKey(productId, size)]: n } : {};
}

/** Try again for rows previously not sent or failed. Production with sync on only. */
export async function retryShopify(movements) {
  if (!SHOPIFY_SYNC_ON) return { sent: 0, notSent: 0, failed: ["Shopify sync is off for this environment."] };
  const rows = (movements || []).filter((m) => ["pending", "not_sent", "failed"].includes(m.shopify_status) && m.legacy_delta);
  return sendToShopify(rows);
}

async function sendToShopify(rows, exact = {}) {
  const sent = [];
  const failed = [];
  // One at a time: two changes to the same size must land in order.
  for (const m of rows) {
    // A full recount sets Shopify to the counted number (a stale count here
    // cannot push Shopify wrong). Everything else is a change: adjust's
    // positive quantity lowers stock, so a sale (legacy_delta -1) sends +1.
    // Retries carry no exact target and are sent as the recorded change.
    const target = exact[sizeKey(m.product_id, m.size)];
    const res = target !== undefined
      ? await setShopifyStock(m.product_id, m.size, target, { source: "stock-room" })
      : await adjustShopifyInventory(m.product_id, m.size, -m.legacy_delta, { source: "stock-room" });
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

/**
 * Shopify → database, read from the page. The edge function itself copies
 * Shopify's per-size counts into product_variants on every read, so this only
 * reads, counts what differed from the catalogue on screen, and reports which
 * designs to reload. It never writes the database.
 *
 * Runs only where sending runs (production with sync switched on).
 *
 * @param products  rows with id, name, sync_enabled
 * @param variants  product_variants rows with id, product_id, size, inventory
 * @returns {Promise<null | { checked, updated, failed: string[], changedProductIds: string[], at }>}
 */
export async function pullShopifyStock(products, variants, { concurrency = 6 } = {}) {
  if (!SHOPIFY_SYNC_ON) return null;
  const lxrts = (products || []).filter((p) => p && p.sync_enabled === true);
  const byProduct = {};
  (variants || []).forEach((v) => { (byProduct[v.product_id] || (byProduct[v.product_id] = [])).push(v); });

  let updated = 0;
  const failed = [];
  const changed = new Set();
  let next = 0;

  const worker = async () => {
    while (next < lxrts.length) {
      const p = lxrts[next];
      next += 1;
      const live = await fetchShopifyInventory(p.id);
      if (!live) { failed.push(p.name || p.id); continue; }
      const n = countDifferences(byProduct[p.id], live);
      if (n) { updated += n; changed.add(p.id); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, lxrts.length) }, worker));
  return { checked: lxrts.length, updated, failed, changedProductIds: [...changed], at: new Date().toISOString() };
}

/**
 * Sizes whose stored count differs from Shopify's. `live` lists sizes in stock
 * only, so a size missing from it is 0 on Shopify. A size stored in more than
 * one row (a known data problem) is compared as one total, the way Shopify's
 * reply sums it, so duplicates are not reported as changes.
 */
export function countDifferences(rows, live) {
  const stored = {};
  for (const v of rows || []) stored[v.size] = (stored[v.size] || 0) + (Number(v.inventory) || 0);
  let n = 0;
  for (const [size, total] of Object.entries(stored)) {
    if (Number(live?.[size] ?? 0) !== total) n += 1;
  }
  return n;
}

/** The every-minute job counts as healthy when its last good run is under 5 minutes old. */
export function jobIsHealthy(state, now = Date.now()) {
  return !!state?.last_ok_at && now - new Date(state.last_ok_at).getTime() < 5 * 60000;
}

/**
 * Keep the screen in step with Shopify. While the every-minute job
 * (shopify-inventory-v2) is healthy it already keeps product_variants current,
 * so the page only asks which designs it changed since `since`. If the job is
 * not running, fall back to reading every LXRTS design from Shopify.
 */
export async function syncWithShopify(products, variants, since) {
  if (!SHOPIFY_SYNC_ON) return null;
  const state = await loadShopifySyncState();
  if (!jobIsHealthy(state)) return pullShopifyStock(products, variants);
  let query = supabase.from("shopify_stock_log").select("product_id").eq("action", "sync");
  if (since) query = query.gt("created_at", since);
  const { data, error } = await query.limit(1000);
  const ids = [...new Set((data || []).map((r) => r.product_id).filter(Boolean))];
  return {
    checked: state.last_checked || 0, updated: error ? 0 : (data || []).length, failed: [],
    changedProductIds: ids, at: state.last_ok_at, viaJob: true,
  };
}
