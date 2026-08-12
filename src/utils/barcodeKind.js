/**
 * barcodeKind — the ONE classifier for every barcode this app can be handed.
 *
 * WHY THIS EXISTS
 * Until product SKUs became scannable there was only one namespace (order
 * pieces), so ScanStation classified with a NEGATIVE test:
 *
 *   isMasterBarcode = (b) => !/-(TOP|BTM|DUP|EX\d+)…$/.test(b)
 *
 * i.e. "anything that isn't a component must be a whole order". That silently
 * became wrong the moment SKU tags existed: isMasterBarcode("SKU-1040") returns
 * TRUE, so a garment tag scanned at a production station gets sent into
 * findOrderByMasterBarcode as ilike '%SKU-1040%' — a nonsense order lookup that
 * reports "order not found" instead of "that's a product tag".
 *
 * Every scan surface must classify through here so the two can't drift apart.
 *
 * THE NAMESPACES (disjoint by shape):
 *   SKU-1040               product SKU        <- pre-printed garment tag
 *   DLC-000376-TOP         order component    <- a physical piece in production
 *   000376-TOP             same, typed without the store prefix
 *   SB-DLC-0726-003625     order master       <- the whole order
 */

// Product SKUs minted by AddProduct / reserve_sku_rows. Anchored and tested
// FIRST — it's the only exclusive positive match, and the master test below is
// loose enough to swallow it otherwise.
export const SKU_PATTERN = /^SKU-\d+$/i;

// A piece of a garment: <STORE>-<6digit>-TOP|BTM|DUP|EX<n>, optionally with a
// product index ("-2") for multi-product orders.
const COMPONENT_PATTERN = /^[A-Za-z][A-Za-z0-9]*-\d{6}-(?:TOP|BTM|DUP|EX\d+)\d*(?:-\d+)?$/i;

// The same piece typed without its store prefix. The 6-digit anchor is
// deliberate and matches PREFIXLESS_BARCODE in barcodeService.js — a shorter
// number could be the tail of a real sequence and resolve to the wrong garment.
const PREFIXLESS_COMPONENT_PATTERN = /^\d{6}-[A-Za-z]+\d*(?:-\d+)?$/;

// An order number: SB-<CHANNEL>-MMYY-NNNNNN. Parsed by dash position, never by
// character offset — the store code may be any length (DLC, LDHC, B2BSTOCK).
const MASTER_PATTERN = /^SB-[A-Za-z0-9]+-\d{4}-\d{6}$/i;

export const BARCODE_KIND = {
  SKU: "sku",
  COMPONENT: "component",
  PREFIXLESS_COMPONENT: "prefixless_component",
  MASTER: "master",
  UNKNOWN: "unknown",
};

/**
 * Classify a scanned/typed barcode.
 *
 * ORDER MATTERS. SKU is tested first (exclusive positive match), then the
 * component shapes, then master. Reordering this reintroduces the exact
 * misrouting bug described at the top of this file.
 *
 * @param {string} raw
 * @returns {string} one of BARCODE_KIND
 */
export function classifyBarcode(raw) {
  const s = (raw || "").trim();
  if (!s) return BARCODE_KIND.UNKNOWN;

  if (SKU_PATTERN.test(s)) return BARCODE_KIND.SKU;
  if (COMPONENT_PATTERN.test(s)) return BARCODE_KIND.COMPONENT;
  if (PREFIXLESS_COMPONENT_PATTERN.test(s)) return BARCODE_KIND.PREFIXLESS_COMPONENT;
  if (MASTER_PATTERN.test(s)) return BARCODE_KIND.MASTER;

  return BARCODE_KIND.UNKNOWN;
}

/** True for a product SKU tag (SKU-1040). */
export const isSkuBarcode = (raw) => classifyBarcode(raw) === BARCODE_KIND.SKU;

/**
 * Normalize a scanned SKU to its stored form. Scanners can deliver lowercase
 * depending on how the label was encoded, and sku_id is stored uppercase.
 * Returns "" if it isn't a SKU at all.
 */
export function normalizeSku(raw) {
  const s = (raw || "").trim().toUpperCase();
  return SKU_PATTERN.test(s) ? s : "";
}
