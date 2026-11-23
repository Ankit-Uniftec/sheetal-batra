// ============================================================
// Old order numbers keep working (Release 39, client 23 Nov 2026).
//
// Orders moved to another department (Stock, Comms, Private, B2B) got a new
// order number with that department's prefix; the number they were placed
// with is kept in orders.legacy_order_no. Printed work orders, barcodes and
// messages still carry the old number, so a lookup by order number must match
// either column.
//
// legacy_order_no is added by db/meeting_points/r39_08_dept_move.sql. Until
// that has run the column does not exist, so every lookup falls back to the
// order number alone instead of failing.
// ============================================================

const missingLegacyColumn = (error) =>
  !!error && /legacy_order_no/i.test(`${error.message || ""} ${error.details || ""} ${error.hint || ""}`);

/**
 * Run an order-number lookup that also matches old numbers.
 * @param {(withLegacy: boolean) => PromiseLike<{data, error}>} build  the query,
 *        with or without the legacy_order_no condition
 * @returns {Promise<{data, error}>}
 */
export async function withLegacyOrderNo(build) {
  const res = await build(true);
  if (missingLegacyColumn(res.error)) return build(false);
  return res;
}

/** PostgREST `or` condition: order_no (and the old number) like the pattern. */
export const orderNoLike = (pattern, withLegacy) =>
  withLegacy ? `order_no.ilike.${pattern},legacy_order_no.ilike.${pattern}` : `order_no.ilike.${pattern}`;
