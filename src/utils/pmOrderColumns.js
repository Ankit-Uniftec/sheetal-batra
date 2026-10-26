import { supabase } from "../lib/supabaseClient";
import { selectAllExcept } from "./fetchAllRowsParallel";

// ============================================================
// The order columns the Production Manager dashboard loads for ALL orders.
//
// Orders have ~157 columns; this screen (and every helper it hands an order
// to) reads only these. Loading just them halves the data (all orders:
// 74 MB / 10.9s -> 37.5 MB / 4.9s, measured 26 Oct 2026).
//
// Derived by scanning ProductionManagerDashboard.jsx and the modules it passes
// orders to (see SCANNED_FILES in pmOrderColumns.test.js) for every order
// column name. That test fails if one of those files starts reading a column
// that is not listed here — add it here when it does.
//
// Actions that hand an order to code OUTSIDE that set (warehouse PDF, Edit,
// Cancel) first load the full row with fetchFullOrder().
// ============================================================
export const PM_ORDER_COLUMNS = [
  "id", "order_no", "items", "status", "created_at", "updated_at",
  "mode_of_delivery", "delivery_date", "delivered_at",
  "salesperson", "salesperson_email", "salesperson_store",
  "delivery_name", "delivery_phone", "delivery_address", "delivery_city", "delivery_state", "delivery_pincode",
  "grand_total", "grand_total_after_discount", "net_total", "total_quantity", "advance_payment", "total_paid",
  "customer_url", "warehouse_url", "warehouse_urls",
  "cancellation_reason", "cancelled_at", "revoked_at",
  "exchange_reason", "exchange_requested_at", "return_reason", "returned_items", "refund_reason", "refund_status",
  "is_alteration", "is_b2b", "vendor_id", "po_number", "b2b_order_type", "approval_status", "approved_by",
  "is_private_order", "is_stock_order", "is_comms", "is_rework",
  "production_status", "in_production_at", "ready_for_dispatch_at", "dispatched_at",
  "priority", "notes", "warehouse_stage", "warehouse_stage_updated_at", "qc_fail_reason",
  "shopify_order_id", "shopify_order_name", "web_order_status",
];

export const PM_ORDER_SELECT = PM_ORDER_COLUMNS.join(",");

let fullColumns = null;

/**
 * The full order row (every column except shopify_raw), for actions that
 * need more than PM_ORDER_COLUMNS. Falls back to the order it was given if
 * the fetch fails, so an action never breaks — it just behaves as before.
 */
export async function fetchFullOrder(order) {
  if (!order?.id) return order;
  try {
    if (!fullColumns) fullColumns = await selectAllExcept("orders", ["shopify_raw"]);
    const { data, error } = await supabase.from("orders").select(fullColumns).eq("id", order.id).maybeSingle();
    if (error || !data) return order;
    return { ...order, ...data };
  } catch {
    return order;
  }
}
