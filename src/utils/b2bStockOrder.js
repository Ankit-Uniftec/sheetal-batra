/**
 * B2B STOCK ORDERS — the shared flag for the B2B internal-stock flow.
 *
 * A B2B stock order is an order for B2B warehouse inventory: no vendor, no
 * customer, no pricing, no payment. It is the B2B twin of the retail/SA stock
 * order (see the isStockOrder handling in ProductForm.js / ReviewDetail.js) and
 * behaves identically — straight into production, all money zeroed. The only
 * difference is the order number, SB-B2BSTOCK-MMYY-NNNNNN, so the printed
 * barcode identifies the channel.
 *
 * WHY THIS MODULE: the flag is read by four screens (the merchandiser dashboard
 * that starts the flow, then the product form, order details and review order).
 * The retail flow inlines the same two-source read in each of its screens, which
 * is exactly how the two copies there drifted. One definition here instead.
 *
 * WHY TWO SOURCES: route state alone is lost on a refresh (React Router state
 * does not survive a reload), and sessionStorage alone is lost on a hard
 * navigation from a fresh tab. The retail flow reads both for the same reason.
 * sessionStorage is the durable one; the route state makes the first render
 * correct without waiting on a storage read.
 */

// The flag key. Distinct from the retail flow's "isStockOrder" so the two can
// never be confused for one another — a retail stock order and a B2B stock
// order are different channels with different permissions and dashboards.
export const B2B_STOCK_FLAG = "isB2bStockOrder";

// The four session keys the B2B order flow writes as it walks
// vendor-selection -> product-form -> order-details -> review-order.
export const B2B_FLOW_SESSION_KEYS = [
  "b2bVendorData",
  "b2bProductFormData",
  "b2bOrderDetailsData",
  "b2bEditingOrderId",
];

/**
 * Is the in-progress order a B2B stock order?
 * @param {object} [locationState] - react-router `location.state`, when available.
 */
export function isB2bStockOrder(locationState) {
  return (
    locationState?.isB2bStockOrder === true ||
    sessionStorage.getItem(B2B_STOCK_FLAG) === "true"
  );
}

/**
 * Begin a B2B stock order. Clears any half-finished normal order first: a
 * stale b2bVendorData from an abandoned vendor flow would otherwise attach a
 * vendor to what must be a vendor-less internal order.
 */
export function startB2bStockOrder() {
  B2B_FLOW_SESSION_KEYS.forEach((k) => sessionStorage.removeItem(k));
  sessionStorage.setItem(B2B_STOCK_FLAG, "true");
}

/**
 * Clear the flag. Call after a successful insert and on logout, so the next
 * order raised in this session doesn't silently inherit stock behaviour (the
 * bug the retail flow's exhibitionOrder key used to have).
 */
export function clearB2bStockOrder() {
  sessionStorage.removeItem(B2B_STOCK_FLAG);
}

/**
 * Is a SAVED order a B2B stock order? Reads the persisted `is_stock_order`
 * column, unlike isB2bStockOrder() above which reads the in-progress flow flag.
 *
 * WHY: a stock order is raised with no vendor, no PO number and no
 * b2b_order_type (see the null-outs in B2bReviewOrder). Every dashboard that
 * renders an order card therefore has three fields that can only ever print an
 * em-dash for these orders. Use this to hide the label and its value entirely
 * rather than showing an empty row — an em-dash reads as "missing data" when in
 * fact the field does not apply to this kind of order at all.
 *
 * @param {object} order - a row from `orders`.
 */
export function isB2bStockOrderRow(order) {
  return order?.is_stock_order === true;
}

/**
 * The fixed internal destination for stock orders — B2B stock ships to the
 * warehouse, not to a vendor. Same value the retail stock flow writes, so both
 * kinds of stock order land in one place on the warehouse side.
 */
export const B2B_STOCK_DELIVERY = {
  delivery_name: "Internal Stock",
  delivery_address: "WH Delhi",
  mode_of_delivery: "WH Delhi",
};
