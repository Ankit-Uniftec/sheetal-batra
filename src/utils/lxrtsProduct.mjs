// "Is any product on this order an LXRTS (ready-stock) piece?" — the ONE rule,
// shared by the Shopify dashboard's payment hold (meeting point 45: unconfirmed
// COD for LXRTS clears) and the Warehouse dashboard, which hides these orders
// from every warehouse account (meeting point 44: the piece already exists and
// is sold directly, so there is nothing to produce).
//
// A plain .mjs with no imports, so node can run the self-tests that import it
// (src/screens/ShopifyOrdersDashboard/payment.test.mjs).
//
// Whole word, any case, product NAME only: "(LXRTS)" and "LXRTS - Aabish"
// match, "LXRTSX" does not. Never shopify_tags (campaign codes such as
// "SB-lxrts_delhi_mumbai_…") and never items[0].sync_enabled — that flag is
// true for EVERY website order and drives the Online Production Head's queue.
const LXRTS_NAME_RE = /\blxrts\b/i;

export const hasLxrtsProduct = (order) =>
  (order?.items || []).some((it) => LXRTS_NAME_RE.test(String(it?.product_name || "")));

/** One product line is an LXRTS (ready-stock) piece. */
export const isLxrtsLine = (item) => LXRTS_NAME_RE.test(String(item?.product_name || ""));

/**
 * EVERY product on the order is LXRTS (charge lines — customisation fees —
 * don't count either way). Only these orders are hidden from the production
 * screens (point 44). A MIXED order — say an LXRTS outfit plus a made-to-order
 * dupatta — stays visible, because its other products still have to be made;
 * its LXRTS lines are tagged instead (isLxrtsLine).
 */
export const isAllLxrtsOrder = (order) => {
  const products = (order?.items || []).filter((it) => !it?.is_charge);
  return products.length > 0 && products.every(isLxrtsLine);
};
