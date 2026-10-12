import { paymentStatus, formatPaymentMode } from "./packagingExport";
import { paymentLabel, paymentLabelVariant } from "../screens/ShopifyOrdersDashboard/pay.mjs";

// The payment line on a dispatch card (meeting point 34: "show similar order
// card as Shopify with payment updates"). Same rules as the Excel export, so
// the card and the sheet can never disagree:
//   - website orders: the Shopify card's own badge (Fully Paid / Partial Paid /
//     COD / COD Confirmed / Not Paid / Refunded…). Amounts are not synced for
//     them, so none are shown.
//   - internal stock and Comms orders: no customer payment.
//   - every other order: Paid / Partially paid / Unpaid from the stored totals,
//     with the amounts.

const num = (v) => (v == null || v === "" ? null : Number(v));

const VARIANT = { Paid: "success", "Partially paid": "warning", Unpaid: "danger", "N/A": "neutral" };

/**
 * @returns {{ label: string, variant: "success"|"info"|"warning"|"danger"|"neutral",
 *             total: number|null, paid: number|null, balance: number|null, mode: string }}
 */
export function orderPayment(order, { isShopify }) {
  if (isShopify) {
    const label = paymentLabel(order);
    return { label, variant: paymentLabelVariant(label), total: null, paid: null, balance: null, mode: "" };
  }
  if (order?.is_stock_order || order?.is_comms) {
    return { label: "No payment (internal)", variant: "neutral", total: null, paid: null, balance: null, mode: "" };
  }
  const { status } = paymentStatus(order, { isShopify: false });
  return {
    label: status,
    variant: VARIANT[status] || "neutral",
    total: num(order?.net_total ?? order?.grand_total_after_discount ?? order?.grand_total),
    paid: num(order?.total_paid ?? order?.advance_payment),
    balance: Math.max(0, num(order?.remaining_payment) ?? 0),
    mode: formatPaymentMode(order),
  };
}
