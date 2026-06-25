// deliveryCharge.js
//
// Single source of truth for the COD / delivery handling charge.
//
// Business rule (decided at the moment of final delivery, NOT at order time):
//   - Store Pickup                          -> no charge
//   - Home Delivery + balance still due > 0 -> ₹250 (COD handling)
//   - Home Delivery + balance fully paid    -> ₹250 waived (no charge)
//
// The charge is intentionally a delivery-time concept: it depends on the
// FINAL delivery method chosen at handover and whether money is actually
// being collected on delivery. It is never baked into the order total at
// placement. Both the "Order Delivered" flow and any total recomputation
// must call this one function so the rule can never drift.

export const COD_CHARGE = 250;

// Canonical delivery method labels. "Store Pickup" and the store-specific
// pickup labels ("Delhi Store" / "Ludhiana Store") are all pickup (no charge);
// "Home Delivery" is the only mode that can attract the charge.
export const DELIVERY_METHODS = {
  HOME_DELIVERY: "Home Delivery",
  STORE_PICKUP: "Store Pickup",
};

// True when the given mode is a home delivery (the only charge-eligible mode).
export function isHomeDelivery(mode) {
  return (mode || "").trim().toLowerCase() === "home delivery";
}

/**
 * Compute the COD/delivery charge for a delivery.
 *
 * @param {object}  args
 * @param {string}  args.finalMode  - the FINAL delivery method at handover
 *                                     (e.g. "Home Delivery" / "Store Pickup").
 * @param {number}  args.balanceDue - outstanding balance at delivery (₹).
 * @param {boolean} [args.waived]   - SA override: waive the charge even when it
 *                                     would otherwise apply (goodwill, VIP, etc.).
 * @returns {number} 250 when Home Delivery and balance > 0 and not waived,
 *                   otherwise 0.
 */
export function computeDeliveryCharge({ finalMode, balanceDue, waived = false }) {
  if (waived) return 0;
  const balance = Number(balanceDue) || 0;
  if (isHomeDelivery(finalMode) && balance > 0) {
    return COD_CHARGE;
  }
  return 0;
}
