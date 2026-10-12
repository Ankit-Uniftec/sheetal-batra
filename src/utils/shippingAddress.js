// Where an order's parcel goes — one rule for every screen (meeting point 34).
//
// Store-delivery orders are saved with mode_of_delivery "Delhi Store" or
// "Ludhiana Store" and NO delivery_address (prod: every one of ~4,300), so a
// screen that only reads delivery_address showed them blank. The store's own
// address is the shipping address for those.
//
// The two addresses were previously typed out separately in CustomerOrderPdf
// and OrderDetails; both now read STORE_ADDRESSES so they cannot disagree.

export const STORE_ADDRESSES = {
  "Delhi Store": "S-208, Greater Kailash II, Basement, New Delhi, Delhi 110048",
  "Ludhiana Store": "S.C.O no. 22, Sun View Plaza Ludhiana, Punjab 142027",
};

const join = (parts) => parts.filter((v) => v && String(v).trim() !== "").join(", ");

// Which store a generic "Store Pickup" order belongs to, from the store the
// order was placed in. null when that does not name one of the two stores.
function pickupStore(order) {
  const s = String(order?.salesperson_store || "").toLowerCase();
  if (s.includes("ludhiana")) return "Ludhiana Store";
  if (s.includes("delhi")) return "Delhi Store";
  return null;
}

/**
 * @returns {{ store: string|null, address: string, missing: boolean }}
 *   store   — "Delhi Store" / "Ludhiana Store" when the parcel goes to a store
 *   address — the full address line ("" when missing)
 *   missing — no address at all: the desk must not ship blind
 */
export function shippingAddressOf(order) {
  const own = join([order?.delivery_address, order?.delivery_city, order?.delivery_state, order?.delivery_pincode]);
  const mode = String(order?.mode_of_delivery || "").trim();
  const store = STORE_ADDRESSES[mode] ? mode : mode.toLowerCase() === "store pickup" ? pickupStore(order) : null;

  // A typed address wins: it is what the SA actually wrote for this order.
  if (own && order?.delivery_address) return { store: null, address: own, missing: false };
  if (store) return { store, address: STORE_ADDRESSES[store], missing: false };
  return { store: null, address: own, missing: !own };
}
