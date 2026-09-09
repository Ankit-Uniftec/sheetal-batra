/**
 * RETAIL ORDER MODE — the mutually-exclusive flags for the /product order flow.
 *
 * The retail flow through ProductForm -> (OrderDetails | ReviewDetail) can be in
 * exactly ONE of four modes: a normal client order, a stock order (internal
 * inventory), a comms order (PR/celebrity/agency), or an exhibition order.
 * Which one it is decides routing, pricing, whether OTP/customer capture runs,
 * and which dashboard the SA lands back on.
 *
 * WHY THIS MODULE: the mode was carried by three independent sessionStorage keys
 * that each screen set and cleared by hand, at ~10 scattered call sites. Nothing
 * enforced that only one could be set, and clearing was best-effort — the stock
 * flag was cleared on a SUCCESSFUL insert but not when an SA abandoned the flow,
 * so a half-finished stock order leaked into the next order raised in that tab
 * and misrouted it. Set the mode through startOrderMode() and the other flags
 * are cleared for you; there is no way to end up in two modes at once.
 *
 * WHY SESSIONSTORAGE AT ALL: React Router state does not survive a refresh, and
 * the order flow spans several routes an SA may reload mid-way. The screens read
 * both sources (route state first, storage as the durable fallback) — see
 * isOrderMode(). Same reasoning as utils/b2bStockOrder.js, which is the B2B twin
 * of this module; B2B keeps its own separate key deliberately.
 */

// One key per mode. `client` is the absence of all of them, not a key.
export const ORDER_MODE_KEYS = {
  stock: "isStockOrder",
  comms: "isCommsOrder",
  exhibition: "exhibitionOrder",
};

// Form drafts belonging to a half-finished order. Carried over from an
// abandoned order they describe the WRONG order, so every mode switch drops
// them along with the mode flags.
//
// NOT included: commsOrderPayload. It is written by CommsOrderForm BEFORE it
// enters comms mode and is read downstream by ProductForm/CommsReviewOrder, so
// clearing it here would erase the payload of the order being started. Its own
// screens clear it on cancel and after a successful insert.
const DRAFT_KEYS = ["screen4FormData", "screen6FormData"];

/**
 * Clear every mode flag and in-progress draft. Call on logout, on cancel, and
 * after a successful insert.
 */
export function clearOrderMode() {
  Object.values(ORDER_MODE_KEYS).forEach((k) => sessionStorage.removeItem(k));
  DRAFT_KEYS.forEach((k) => sessionStorage.removeItem(k));
}

/**
 * Enter one order mode, exclusively. Every other mode flag and every stale
 * draft is cleared first, so no previous half-finished order can bleed through.
 *
 * @param {"client"|"stock"|"comms"|"exhibition"} mode
 * @param {string} [value] - payload for modes that carry one (exhibition stores
 *   a JSON context blob rather than "true").
 */
export function startOrderMode(mode, value = "true") {
  clearOrderMode();
  if (mode === "client") return; // client mode IS the cleared state
  const key = ORDER_MODE_KEYS[mode];
  if (!key) throw new Error(`Unknown order mode: ${mode}`);
  sessionStorage.setItem(key, value);
}

/**
 * Is the in-progress order in this mode? Reads route state first so the very
 * first render is correct, then sessionStorage which survives a refresh.
 *
 * @param {"stock"|"comms"|"exhibition"} mode
 * @param {object} [locationState] - react-router `location.state`, when available.
 */
export function isOrderMode(mode, locationState) {
  const stateKey = { stock: "isStockOrder", comms: "isCommsOrder", exhibition: "exhibitionOrder" }[mode];
  if (locationState?.[stateKey] === true) return true;
  const stored = sessionStorage.getItem(ORDER_MODE_KEYS[mode]);
  // exhibition stores a JSON blob; the others store the string "true".
  return mode === "exhibition" ? !!stored : stored === "true";
}
