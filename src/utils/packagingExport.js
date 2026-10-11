// Packaging desk "Export Excel" (meeting point 43) — the row builder.
//
// One row per PRODUCT line, not per order: stage, size and colour are per
// product, and the desk ships product by product (per-product dispatch, 36/85).
// Charge lines (customisation fees, items[].is_charge) are not garments and
// have no pieces, so they get no row.
//
// Pure: everything that touches the app (channel label, stage label, T-2 date,
// date format, Shopify payment state) is passed in, so this file can be tested
// without Supabase.
//
// Money is a SEPARATE input (`moneyById`), never merged into the order rows:
// the desk's cards deliberately load no money columns (PackagingDashboard
// ORDER_COLUMNS), and keeping the two apart is what lets the orderColumns test
// keep holding that list to "every order field the screen reads".

export const EXPORT_HEADERS = [
  "Order Number",
  "Shopify No / PO No",
  "Channel",
  "Order Date",
  "Dispatch Date (T-2)",
  "Product Name",
  "Qty",
  "Size",
  "Color",
  "Top — Stage",
  "Bottom — Stage",
  "Dupatta — Stage",
  "Extras — Stage",
  "Payment",
  "Balance",
  "Mode of Payment",
];

const colorName = (c) => (c && typeof c === "object" ? c.name || "" : c || "");

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

/**
 * "UPI ₹100 + Cash ₹17,000" for a split payment (payment_mode holds a JSON
 * array of {mode, amount}); the plain string otherwise.
 */
export function formatPaymentMode(money) {
  const raw = money?.payment_mode;
  if (raw == null || raw === "") return "";
  if (money?.is_split_payment || String(raw).trim().startsWith("[")) {
    try {
      const parts = JSON.parse(raw);
      if (Array.isArray(parts) && parts.length) {
        return parts.map((p) => `${p.mode || "?"} ${inr(p.amount)}`).join(" + ");
      }
    } catch {
      /* not JSON — fall through to the raw text */
    }
  }
  return String(raw);
}

/**
 * Paid / Partially paid / Unpaid / N/A, plus the balance to show.
 *
 *  - Internal stock and Comms orders carry no customer payment → N/A.
 *  - Website (Shopify) orders: Shopify's own financial status. Amounts are not
 *    synced for them, so the balance is left blank rather than guessed.
 *  - Every other order: from the stored totals (total_paid / remaining_payment,
 *    the same columns the Payment Summary on the order page reads).
 */
export function paymentStatus(money, { isShopify, noCustomerPayment = false }) {
  if (noCustomerPayment) return { status: "N/A", balance: "" };
  if (isShopify) {
    const s = String(money?.shopify_financial_status || "").toUpperCase();
    if (s === "PAID") return { status: "Paid", balance: "" };
    if (s === "PARTIALLY_PAID" || s === "AUTHORIZED") return { status: "Partially paid", balance: "" };
    return { status: "Unpaid", balance: "" };
  }
  const remaining = Number(money?.remaining_payment ?? 0);
  const paid = Number(money?.total_paid ?? money?.advance_payment ?? 0);
  if (remaining <= 0) return { status: "Paid", balance: inr(0) };
  if (paid > 0) return { status: "Partially paid", balance: inr(remaining) };
  return { status: "Unpaid", balance: inr(remaining) };
}

/**
 * Where one piece is: "<stage> · Internal" or "<stage> · External — <vendor>".
 * Several pieces of one kind (EX1, EX2…) are joined with " | ".
 */
function pieceText(pieces, stageLabel) {
  if (!pieces.length) return "—";
  return pieces
    .map((c) => {
      const stage = stageLabel(c) || "—";
      const where = c.is_outside_wh ? `External — ${c.vendor_name || "vendor"}` : "Internal";
      return pieces.length > 1 ? `${c.component_label || c.component_type}: ${stage} · ${where}` : `${stage} · ${where}`;
    })
    .join(" | ");
}

const TYPE_KEY = { top: "top", bottom: "bottom", dupatta: "dupatta", extra: "extra" };

/**
 * @param {object[]} orders            orders rows as the desk loads them (no money)
 * @param {object}   componentsByOrder { [orderId]: order_components rows }
 * @param {object}   moneyById         { [orderId]: payment_mode, is_split_payment,
 *                                     total_paid, advance_payment, remaining_payment,
 *                                     shopify_financial_status, shopify_order_name, po_number }
 * @param {object}   deps
 * @param {(o)=>string}  deps.channelLabel   getOrderChannelLabel
 * @param {(c)=>string}  deps.stageLabel     getComponentStageLabel
 * @param {(d,c)=>string} deps.warehouseDate getWarehouseDate
 * @param {(ts)=>string} deps.formatDate
 * @param {(o)=>boolean} deps.isShopify      website order?
 * @returns {Array[]} rows in EXPORT_HEADERS order
 */
export function buildPackagingExportRows(orders, componentsByOrder, moneyById, deps) {
  const rows = [];
  for (const o of orders || []) {
    const comps = componentsByOrder?.[o.id] || [];
    const money = moneyById?.[o.id] || {};
    // Internal stock and Comms orders carry no customer payment.
    const noCustomerPayment = !!(o.is_stock_order || o.is_comms);
    const { status, balance } = paymentStatus(money, { isShopify: deps.isShopify(o), noCustomerPayment });
    const mode = noCustomerPayment ? "N/A" : formatPaymentMode(money);
    const items = (o.items || []).map((it, idx) => ({ it, idx })).filter(({ it }) => !it?.is_charge);
    for (const { it, idx } of items) {
      const mine = comps.filter((c) => (c.item_index ?? 0) === idx);
      const byType = (t) => mine.filter((c) => TYPE_KEY[c.component_type] === t);
      const colors = [colorName(it.top_color), colorName(it.bottom_color)].filter(Boolean);
      rows.push([
        o.order_no || "",
        money.shopify_order_name || money.po_number || "",
        deps.channelLabel(o),
        deps.formatDate(o.created_at) || "",
        deps.warehouseDate(o.delivery_date, o.created_at) || "",
        it.product_name || "",
        it.quantity ?? "",
        it.size || it.size_label || "",
        colors.length === 2 && colors[0] === colors[1] ? colors[0] : colors.join(" / "),
        pieceText(byType("top"), deps.stageLabel),
        pieceText(byType("bottom"), deps.stageLabel),
        pieceText(byType("dupatta"), deps.stageLabel),
        pieceText(byType("extra"), deps.stageLabel),
        status,
        balance,
        mode,
      ]);
    }
  }
  return rows;
}
