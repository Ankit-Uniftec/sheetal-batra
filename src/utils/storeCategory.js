// ============================================================
// Store category — divides products by retail location.
//
// Products carry a `store_category` of one of these values. "All Stores"
// products are visible to every store; the others are location-specific.
// ============================================================

export const STORE_CATEGORIES = ["All Stores", "Delhi", "Ludhiana"];
export const DEFAULT_STORE_CATEGORY = "All Stores";

/**
 * Normalize a salesperson's (messy) store_name to a canonical store key.
 * The data uses many spellings — "Delhi", "DLC", "Delhi Store" for Delhi;
 * "Ludhiana", "Ludhiana Store", "ldhc", "llc" for Ludhiana. Returns
 * "Delhi", "Ludhiana", or null when it can't confidently classify.
 */
export const normalizeStore = (storeName) => {
  const s = String(storeName || "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("delhi") || s === "dlc") return "Delhi";
  if (s.includes("ludhiana") || s.includes("ldhc") || s.includes("llc")) return "Ludhiana";
  return null;
};

/**
 * Should this product be visible to an SA at the given store?
 *
 * - "All Stores" products are always visible.
 * - Store-specific products are visible only at their store.
 * - If the SA's store can't be classified (saStore=null), FAIL OPEN —
 *   show everything rather than hide products from an unknown store.
 * - A product with no/blank store_category is treated as "All Stores"
 *   (covers rows created before this column existed and any gaps).
 */
export const isProductVisibleForStore = (product, saStore) => {
  if (saStore == null) return true; // fail open for unrecognized SA store
  const cat = (product?.store_category || "").trim();
  if (!cat || cat === "All Stores") return true;
  return cat === saStore;
};
