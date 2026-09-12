// ============================================================
// WHAT A PRODUCTION HEAD MUST NOT SEE — the one rule, in one place.
//
// A Production Head runs the factory floor. To do that they need the garment,
// its components, its stages and the date the warehouse must finish by. They do
// NOT need who bought it, what it cost, or when the customer is promised it.
//
// THREE CATEGORIES, and why each is hidden:
//
//   1. CLIENT IDENTITY — name, phone, email, address. The PH never contacts the
//      customer; sales and dispatch do. Leaking it turns every factory screen
//      into a customer database.
//
//   2. ORDER MONEY — item price, subtotal, GST, discounts, grand total, and the
//      price FILTERS/SORTS built on them. What a garment sold for has no bearing
//      on how it is made, and it is the single most sensitive column on `orders`.
//
//      NOT covered: internal production loss (QC scrap loss, dispose loss
//      amount). Those are the PH's own cost figures, recorded BY them — a
//      deliberate carve-out, not an oversight.
//
//   3. THE CUSTOMER DELIVERY DATE — `orders.delivery_date`. The PH works to the
//      WAREHOUSE date, which is T-2 (getWarehouseDate in ./warehouseDate).
//      Showing the customer date invites working to the later deadline and
//      losing the two-day buffer that exists to absorb dispatch. Where a screen
//      needs a date it must render getWarehouseDate(delivery_date, created_at),
//      never the raw column.
//
// WHY A HELPER RATHER THAN DELETING THE JSX
// Some screens are shared (an order card rendered for both a merchandiser and a
// PH), so the field must be conditional, not gone. One predicate here keeps the
// rule from drifting into a different `role !==` spelling on every screen.
//
// SHOPIFY IS A DELIBERATE EXCEPTION for client NAME only — that dashboard is
// documented as intentionally showing it, and that decision stands. Money and
// the raw date are hidden there like everywhere else.
// ============================================================

// The roles that run production and must not see customer/commercial data.
// "production"          — B2B Production Head (salesperson.role)
// "offline production head" / "online production head" — retail PHs
const PRODUCTION_ROLES = new Set([
  "production",
  "offline production head",
  "online production head",
]);

// True when this role is a Production Head and the three categories above must
// be withheld. Unknown/missing role → false: this helper decides what to HIDE,
// and a screen that cannot resolve its role should not silently reveal less
// than its own guard already allows.
export function isProductionRole(role) {
  return PRODUCTION_ROLES.has(String(role || "").trim().toLowerCase());
}

// Convenience inverse, so a JSX guard reads as what it shows rather than a
// double negative: {canSeeOrderMoney(role) && <GrandTotal/>}
export const canSeeOrderMoney = (role) => !isProductionRole(role);
export const canSeeClientIdentity = (role) => !isProductionRole(role);

// The `orders` columns that carry the three categories. Used to narrow a
// `.select("*")` so the data never reaches the browser at all — hiding the JSX
// alone still ships every figure to the network tab.
export const CLIENT_IDENTITY_COLUMNS = [
  "delivery_name", "delivery_phone", "delivery_email",
  "delivery_address", "delivery_city", "delivery_state", "delivery_pincode",
];

export const ORDER_MONEY_COLUMNS = [
  "subtotal", "taxes", "grand_total", "grand_total_after_discount", "net_total",
  "discount_amount", "discount_percent", "discount_code",
  "markdown_amount", "markdown_percent",
  "advance_paid", "balance_due", "total_paid", "refund_amount",
];
