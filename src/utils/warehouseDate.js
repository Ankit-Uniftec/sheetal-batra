import formatDate from "./formatDate";

// ============================================================
// The WAREHOUSE date (T-2) — the deadline production works to.
//
// The customer's delivery_date is the date the client is promised. Production
// must finish 2 days earlier to leave room for QC, packing and dispatch, so
// every warehouse-facing surface shows delivery_date - 2 days.
//
// EXCEPTION: a rush order placed less than 2 days before its delivery date has
// no room to subtract from — showing T-2 there would put the deadline on or
// before the order date. Those show the real delivery date instead.
//
// This is the ONE definition of that rule. It was previously copy-pasted in
// WarehouseDashboard.jsx (twice) and WarehouseOrderPdf.js, and missing entirely
// from the Production Manager dashboard — which is why the PM saw the customer
// date while the warehouse saw T-2 for the same order.
// ============================================================

// The T-2 date as a Date object (null when there's no usable delivery date).
export function getWarehouseDateObj(deliveryDate, orderDate) {
  if (!deliveryDate) return null;
  const d = new Date(deliveryDate);
  if (isNaN(d.getTime())) return null;

  if (orderDate) {
    const placed = new Date(orderDate);
    if (!isNaN(placed.getTime())) {
      const gapDays = Math.floor((d - placed) / 86400000);
      // Only subtract when the order had at least 2 days to run.
      if (gapDays >= 2) d.setDate(d.getDate() - 2);
    }
  }
  return d;
}

// The T-2 date formatted as DD-MM-YYYY, matching formatDate everywhere else.
// Returns the given placeholder when there's no usable date.
export function getWarehouseDate(deliveryDate, orderDate, placeholder = "—") {
  const d = getWarehouseDateObj(deliveryDate, orderDate);
  return d ? formatDate(d) : placeholder;
}
