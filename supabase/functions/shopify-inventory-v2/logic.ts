// ============================================================
// shopify-inventory-v2 — pure logic (no Deno, no network).
//
// Kept apart from index.ts so it can be unit-tested in Node
// (logic.test.js transpiles this file with Babel and runs it).
// ============================================================

/** Roles allowed to SET an exact LXRTS count by hand (dashboard editors). */
export const SET_ROLES = [
  "inventory", "admin", "assistant_cmo", "gm", "coo", "ceo", "store_manager",
];

/** Shopify API version. 2026-10 is supported until 16 Oct 2027. */
export const SHOPIFY_API_VERSION = "2026-10";

/** How many designs one Shopify read asks for (keeps each query's cost low). */
export const PRODUCTS_PER_QUERY = 6;

/** Designs re-checked each sync run besides the ones just sold on the website. */
export const ROTATION_BATCH = 20;

/**
 * Put a Shopify id into GID form. A GID is returned untouched; a bare number
 * becomes gid://shopify/<type>/<n>; anything else comes back trimmed, unchanged.
 */
export function toGid(value: unknown, type: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^gid:\/\/shopify\/[A-Za-z]+\/\d+$/.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `gid://shopify/${type}/${raw}`;
  return raw;
}

/** The "available" number in a quantities list, or null when absent. */
export function availableOf(quantities: any): number | null {
  const q = (Array.isArray(quantities) ? quantities : []).find((x: any) => x?.name === "available");
  return q && Number.isFinite(Number(q.quantity)) ? Number(q.quantity) : null;
}

/**
 * Choose the Shopify location to read and write for one inventory item.
 *
 * - A configured location (SHOPIFY_LOCATION_ID) always wins; an item not
 *   stocked there is an error rather than a silent fallback.
 * - With none configured, the item must be stocked at exactly ONE location.
 *   Several means we cannot know which one holds LXRTS stock, so we refuse
 *   instead of guessing (the old function took "whichever came first" and
 *   compared it with the total of all locations).
 *
 * @param level   the item's inventoryLevel(locationId:) node, when configured
 * @param levels  the item's inventoryLevels nodes, when not configured
 */
export function pickLevel(
  configuredLocation: string,
  level: any,
  levels: any[] | null | undefined,
): { locationId: string; available: number } | { error: string } {
  if (configuredLocation) {
    if (!level) return { error: "This size is not stocked at the Shopify location set for LXRTS." };
    const available = availableOf(level.quantities);
    if (available === null) return { error: "Shopify did not return an available quantity." };
    return { locationId: level.location?.id || configuredLocation, available };
  }
  const list = (levels || []).filter(Boolean);
  if (!list.length) return { error: "This size is not stocked at any Shopify location." };
  if (list.length > 1) {
    return { error: "This size is stocked at several Shopify locations. Set SHOPIFY_LOCATION_ID so the right one is used." };
  }
  const available = availableOf(list[0].quantities);
  if (available === null) return { error: "Shopify did not return an available quantity." };
  return { locationId: list[0].location?.id || "", available };
}

/** The size option of a Shopify variant ("" when there is none). */
export function sizeOf(variant: any): string {
  const opt = (variant?.selectedOptions || []).find((o: any) => String(o?.name || "").toLowerCase() === "size");
  return String(opt?.value || "").trim();
}

/**
 * Turn one Shopify product node into per-variant readings.
 * Custom-size variants are skipped (as the old function did).
 */
export function readingsFromProduct(product: any, configuredLocation: string) {
  const out: Array<{
    variantId: string; size: string; price: number | null; inventoryItemId: string;
    available: number | null; error: string | null;
  }> = [];
  for (const v of product?.variants?.nodes || []) {
    const size = sizeOf(v);
    if (!size || size.toLowerCase().includes("custom")) continue;
    const item = v.inventoryItem || {};
    const picked = pickLevel(configuredLocation, item.inventoryLevel, item.inventoryLevels?.nodes);
    const price = Number.parseFloat(v.price);
    out.push({
      variantId: v.id,
      size,
      price: Number.isFinite(price) ? price : null,
      inventoryItemId: item.id || "",
      available: "error" in picked ? null : picked.available,
      error: "error" in picked ? picked.error : null,
    });
  }
  return out;
}

/**
 * The row a change for one size goes to when the size is stored more than once
 * (Shopify has two variants per size on many designs): linked to Shopify
 * first, then the most stock, then id — so a sale comes off the variant that
 * actually holds the stock.
 */
export function canonicalRow<T extends { id: string; inventory?: unknown; shopify_variant_id?: unknown }>(rows: T[]): T | null {
  const sorted = [...(rows || [])].sort((a, b) =>
    (toGid(b.shopify_variant_id, "ProductVariant") ? 1 : 0) - (toGid(a.shopify_variant_id, "ProductVariant") ? 1 : 0)
    || (Number(b.inventory) || 0) - (Number(a.inventory) || 0)
    || String(a.id).localeCompare(String(b.id)));
  return sorted[0] || null;
}

export const sizeKey = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const isCustom = (s: unknown) => sizeKey(s).includes("custom");

/**
 * Shopify's variant for an app size, matched by size name (S = s = " S ").
 * Two candidate variants with the same size name → no match (never guess).
 */
export function matchBySize<T extends { size: string }>(size: unknown, readings: T[]): T | null {
  const hits = (readings || []).filter((r) => sizeKey(r.size) === sizeKey(size));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Compare the app's size rows for ONE design with Shopify's readings.
 *
 * Each app row mirrors ONE Shopify variant, so the app's per-size total equals
 * Shopify's (a size with two Shopify variants keeps two rows). A row with no
 * variant id, or one not on this product, is linked by size name to a Shopify
 * variant no other row holds. A row that copies another row's variant, or
 * cannot be linked while its size is covered by another row, is kept at 0 so
 * the size is not counted twice. Custom sizes are ignored.
 *
 * @returns updates (only rows that differ), sizes with no Shopify match,
 *          failed readings, and the rows newly linked.
 */
export function planUpdates(rows: any[], readings: ReturnType<typeof readingsFromProduct>) {
  const byVariant = new Map(readings.map((r) => [r.variantId, r]));
  const updates: Array<{ id: string; fields: Record<string, unknown>; size: string; from: number; to: number | null }> = [];
  const unlinked: string[] = [];
  const failed: string[] = [];
  const linked: Array<{ id: string; size: string; variantId: string }> = [];
  const real = (rows || []).filter((r) => !isCustom(r.size));
  // Most stock first, so when two rows copy one variant the stocked one keeps it.
  const ordered = [...real].sort((a, b) => (Number(b.inventory) || 0) - (Number(a.inventory) || 0) || String(a.id).localeCompare(String(b.id)));
  const claimed = new Set<string>();
  const holder = new Map<string, ReturnType<typeof readingsFromProduct>[number]>(); // row id → reading
  for (const row of ordered) {
    const gid = toGid(row.shopify_variant_id, "ProductVariant");
    if (gid && byVariant.has(gid) && !claimed.has(gid)) { claimed.add(gid); holder.set(row.id, byVariant.get(gid)!); }
  }
  for (const row of ordered) {
    if (holder.has(row.id)) continue;
    const free = readings.filter((r) => !claimed.has(r.variantId));
    const m = matchBySize(row.size, free);
    if (m) { claimed.add(m.variantId); holder.set(row.id, m); linked.push({ id: row.id, size: row.size, variantId: m.variantId }); }
  }
  const covered = new Set(real.filter((r) => holder.has(r.id)).map((r) => sizeKey(r.size)));
  const reported = new Set<string>();
  for (const row of real) {
    const r = holder.get(row.id);
    let target: number;
    const fields: Record<string, unknown> = {};
    if (r) {
      if (r.error || r.available === null) { failed.push(`${row.size}: ${r.error || "no quantity"}`); continue; }
      target = r.available;
      if (r.price !== null && row.price !== undefined && Number(row.price) !== r.price) fields.price = r.price;
      if (r.inventoryItemId && row.shopify_inventory_item_id !== r.inventoryItemId) fields.shopify_inventory_item_id = r.inventoryItemId;
      if (toGid(row.shopify_variant_id, "ProductVariant") !== r.variantId) fields.shopify_variant_id = r.variantId;
    } else if (covered.has(sizeKey(row.size))) {
      target = 0; // a copy: another row already mirrors this size on Shopify
    } else {
      if (!reported.has(sizeKey(row.size))) { unlinked.push(row.size); reported.add(sizeKey(row.size)); }
      continue;
    }
    if (Number(row.inventory) !== target) fields.inventory = target;
    if (Object.keys(fields).length) {
      updates.push({ id: row.id, fields, size: row.size, from: Number(row.inventory) || 0, to: fields.inventory === undefined ? null : target });
    }
  }
  return { updates, unlinked, failed, linked };
}

/** { size: qty } of sizes in stock — the shape every app caller already reads. */
export function inventoryMap(rows: Array<{ size: string; inventory: number }>) {
  const map: Record<string, number> = {};
  for (const r of rows || []) {
    const n = Number(r.inventory) || 0;
    if (r.size && n > 0) map[r.size] = (map[r.size] || 0) + n;
  }
  return map;
}

/**
 * The delta to send for a write.
 *  adjust: `change` as given (+ adds, − removes); must be a non-zero integer.
 *  set:    target − current; target must be a whole number ≥ 0.
 */
export function deltaFor(action: string, current: number, change: unknown, target: unknown): { delta: number } | { error: string } {
  if (action === "adjust") {
    const d = Number(change);
    if (!Number.isInteger(d) || d === 0) return { error: "change must be a whole number other than 0." };
    return { delta: d };
  }
  if (action === "set") {
    const t = Number(target);
    if (!Number.isInteger(t) || t < 0) return { error: "quantity must be a whole number, 0 or more." };
    return { delta: t - current };
  }
  return { error: `Unknown write action: ${action}` };
}

/** Whether a Shopify userErrors list says the expected quantity was stale. */
export function isStale(userErrors: any[]): boolean {
  return (userErrors || []).some((e) => e?.code === "CHANGE_FROM_QUANTITY_STALE"
    || /change.?from.?quantity|stale/i.test(String(e?.message || "")));
}

/** Product ids of synced lines in website orders (for the sync run). */
export function soldProductIds(orders: Array<{ items: any }>): string[] {
  const ids = new Set<string>();
  for (const o of orders || []) {
    for (const it of Array.isArray(o.items) ? o.items : []) {
      if (it?.product_id && (it.sync_enabled === true || it.sync_enabled === "true")) ids.add(String(it.product_id));
    }
  }
  return [...ids];
}

/**
 * The next rotation batch: `size` ids after `cursor` in id order, wrapping
 * to the start. Returns the batch and the cursor to store for next time.
 */
export function nextBatch(allIds: string[], cursor: string | null, size: number) {
  const ids = [...allIds].sort();
  if (!ids.length) return { batch: [] as string[], cursor: null as string | null };
  let start = cursor ? ids.findIndex((id) => id > cursor) : 0;
  if (start < 0) start = 0;
  const batch: string[] = [];
  for (let i = 0; i < Math.min(size, ids.length); i++) batch.push(ids[(start + i) % ids.length]);
  return { batch, cursor: batch[batch.length - 1] };
}

/** Split a list into chunks of n. */
export function chunk<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}
