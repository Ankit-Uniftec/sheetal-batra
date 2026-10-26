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

// The session key that turns the B2B order flow into an EDIT of an existing
// order. While it is set, the review screen UPDATES that order instead of
// creating a new one.
export const B2B_EDIT_KEY = "b2bEditingOrderId";

/**
 * Forget any in-progress B2B order or edit (all flow keys + the stock flag).
 *
 * WHY: the edit key used to be cleared ONLY after a successful save. An edit
 * that was opened and then abandoned left it behind, and the next NEW order
 * raised in that browser tab silently overwrote the old order (its PO,
 * client and products replaced). Call this whenever a new order starts and
 * whenever a B2B dashboard opens.
 */
export function clearB2bOrderFlow() {
  B2B_FLOW_SESSION_KEYS.forEach((k) => sessionStorage.removeItem(k));
  sessionStorage.removeItem(B2B_STOCK_FLAG);
  sessionStorage.removeItem(B2B_GIFTING_FLAG);
}

/** Start a NEW normal B2B order: nothing from an earlier order or edit carries over. */
export const startNewB2bOrder = clearB2bOrderFlow;

/**
 * Start editing one order: clears leftovers first, then remembers only this
 * order. Pass the order row (or `{ gifting: true }`) so editing a Partner
 * Gifting order stays a gifting order instead of reopening as a priced one.
 */
export function beginB2bEdit(orderId, orderOrOpts = null) {
  clearB2bOrderFlow();
  sessionStorage.setItem(B2B_EDIT_KEY, orderId);
  if (orderOrOpts?.gifting === true || isPartnerGiftingRow(orderOrOpts)) {
    sessionStorage.setItem(B2B_GIFTING_FLAG, "true");
  }
}

/** Is the B2B flow currently editing an existing order? */
export const isEditingB2bOrder = () => !!sessionStorage.getItem(B2B_EDIT_KEY);

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

// ============================================================
// B2B PARTNER GIFTING (Release 24, open point #14)
//
// A gift to one of our B2B partners, modelled on Comms gifting: the products
// are picked at their real prices (so the gift's value is on record) but the
// order total is ₹0 — no charge, no vendor credit, not a sale. Approval works
// like any B2B order (merchandiser: auto-approved; executive: waits for the
// merchandiser). Saved as a normal SB-B2B order with is_gifting = true and
// b2b_order_type = "Partner Gifting". The order PDF shows the B2B team number.
// ============================================================
export const B2B_GIFTING_FLAG = "isB2bPartnerGifting";
export const PARTNER_GIFTING_TYPE = "Partner Gifting";
export const B2B_TEAM_PHONE = "+91 98706 29038";
export const PARTNER_GIFTING_PURPOSES = [
  "Festive gifting", "Store launch / event", "Relationship gesture", "Display / showcase", "Other",
];

/** Is the in-progress B2B order a Partner Gifting order? */
export function isB2bGifting(locationState) {
  return (
    locationState?.isB2bGifting === true ||
    sessionStorage.getItem(B2B_GIFTING_FLAG) === "true"
  );
}

/** Begin a NEW Partner Gifting order (nothing from an earlier order carries over). */
export function startB2bGifting() {
  clearB2bOrderFlow();
  sessionStorage.setItem(B2B_GIFTING_FLAG, "true");
}

// The order note line the review writes for a gifting order. Read back on
// Edit so purpose / POC come back into the form (and the line is not doubled).
const GIFT_LINE = /^Partner Gifting — Purpose: (.*?)(?: · POC: (.*))?$/;

/** The gifting line written into orders.comments. */
export function partnerGiftingNote(purpose, pocName) {
  return `Partner Gifting — Purpose: ${purpose || ""}${pocName ? ` · POC: ${pocName}` : ""}`;
}

/**
 * The b2bVendorData fields for editing a saved Partner Gifting order: the
 * recipient, purpose and POC, plus remarks without the gifting line.
 */
export function giftingSessionFields(order) {
  let purpose = "";
  let pocName = "";
  const rest = String(order?.comments || "").split("\n\n").filter((part) => {
    const m = part.match(GIFT_LINE);
    if (!m) return true;
    purpose = m[1] || "";
    pocName = m[2] || "";
    return false;
  });
  const listed = PARTNER_GIFTING_PURPOSES.includes(purpose) && purpose !== "Other";
  return {
    isGifting: true,
    orderType: PARTNER_GIFTING_TYPE,
    poNumber: "",
    recipientName: order?.gift_recipient_name || order?.delivery_name || "",
    recipientContact: order?.gift_recipient_contact || order?.delivery_phone || "",
    recipientEmail: order?.delivery_email || "",
    pocName,
    purpose: listed ? purpose : (purpose ? "Other" : ""),
    purposeOther: listed ? "" : purpose,
    finalPurpose: purpose,
    remarks: rest.join("\n\n"),
  };
}

/** Is a SAVED order a Partner Gifting order? */
export function isPartnerGiftingRow(order) {
  return order?.is_b2b === true && order?.b2b_order_type === PARTNER_GIFTING_TYPE;
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
