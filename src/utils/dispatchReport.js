// ============================================================
// Dispatch report (open point #11) — every box (shipment) dispatched in a
// period, one row per box: an order shipped in two parts shows twice.
//
// Used by the Packaging (Aryadeep) and Production Manager dashboards through
// components/DispatchReport.jsx. Reads shipments (created at the packaging
// station when a box leaves; see utils/barcodeService createShipment) and the
// orders / pieces / payments behind them. Read-only.
//
// Amount: the BOX's value and what is still TO COLLECT for it, from the same
// per-box split DeliveryPaymentModal uses (utils/shipmentBalance). If an
// order's item prices don't add up to its total, that split refuses; the row
// then falls back to the order-level balance (single-box orders) or "—".
// ============================================================
import { supabase } from "../lib/supabaseClient";
import { fetchAllRowsParallel, runLimited } from "./fetchAllRowsParallel";
import { shipmentBalances, orderNetTotal } from "./shipmentBalance";
import { getOrderChannelLabel } from "./barcodeService";

const ORDER_COLUMNS = [
  "id", "order_no", "created_at", "delivery_date", "items", "status",
  "delivery_name", "delivery_phone", "delivery_address", "delivery_city", "delivery_state", "delivery_pincode",
  "mode_of_delivery", "payment_mode", "is_split_payment", "shopify_financial_status",
  "net_total", "grand_total", "grand_total_after_discount", "discount_amount",
  "advance_payment", "total_paid", "is_b2b", "vendor_id", "is_stock_order", "is_comms",
  "is_private_order", "salesperson_store", "shopify_order_id", "is_gifting", "b2b_order_type",
].join(",");

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** How the order is paid, in words. */
export function paymentModeOf(order) {
  if (!order) return "";
  if (order.is_stock_order) return "Internal stock";
  if (order.is_b2b && order.b2b_order_type === "Partner Gifting") return "Gift (no charge)";
  if (order.shopify_order_id) {
    const s = String(order.shopify_financial_status || "").toUpperCase();
    if (s === "PAID") return "Prepaid (website)";
    if (s === "PENDING" || s === "AUTHORIZED") return "COD (website)";
    return s ? `Website · ${s.toLowerCase()}` : "Website";
  }
  const mode = String(order.payment_mode || "").trim();
  if (order.is_split_payment) return mode ? `Split (${mode})` : "Split";
  // B2B partners pay against an invoice; the order records no payment mode.
  if (!mode && order.is_b2b) return "B2B (invoice)";
  return mode;
}

const addressOf = (o) =>
  [o?.delivery_address, o?.delivery_city, o?.delivery_state].filter((x) => x && String(x).trim()).join(", ");

/**
 * One row per dispatched box. Pure — everything it needs is passed in.
 *
 * @param {object} p
 * @param {Array}  p.dispatched   shipments dispatched in the period, each with shipment_components[]
 * @param {Array}  p.orders       their orders
 * @param {Array}  p.allShipments every shipment of those orders (for the per-box money split)
 * @param {Array}  p.components   order_components of those orders { id, order_id, item_index, component_label, component_type }
 * @param {Array}  p.payments     order_payments of those orders { order_id, amount, shipment_id }
 * @param {Object} p.vendorNames  vendor_id -> store_brand_name (B2B client name)
 */
export function buildDispatchRows({ dispatched = [], orders = [], allShipments = [], components = [], payments = [], vendorNames = {} }) {
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const compById = new Map(components.map((c) => [c.id, c]));
  const byOrder = (list) => list.reduce((m, x) => { (m[x.order_id] = m[x.order_id] || []).push(x); return m; }, {});
  const shipsByOrder = byOrder(allShipments);
  const compsByOrder = byOrder(components);
  const paysByOrder = byOrder(payments);

  const balanceCache = new Map();
  const balancesFor = (order) => {
    if (balanceCache.has(order.id)) return balanceCache.get(order.id);
    const ships = shipsByOrder[order.id] || [];
    const links = ships.flatMap((s) => (s.shipment_components || []).map((sc) => ({ shipment_id: s.id, component_id: sc.component_id })));
    let map = null;
    try {
      map = shipmentBalances(order, ships, compsByOrder[order.id] || [], links, paysByOrder[order.id] || []);
    } catch {
      map = null; // prices don't add up to the order total — fall back below
    }
    balanceCache.set(order.id, map);
    return map;
  };

  return dispatched
    .map((s) => {
      const order = orderById.get(s.order_id);
      if (!order) return null;
      const pieces = (s.shipment_components || []).map((sc) => compById.get(sc.component_id)).filter(Boolean);
      const itemIdx = [...new Set(pieces.map((c) => c.item_index ?? 0))].sort((a, b) => a - b);
      const products = itemIdx
        .map((i) => order.items?.[i])
        .filter(Boolean)
        .map((it) => `${it.product_name || "Product"}${it.size ? ` (${it.size})` : ""}${Number(it.quantity) > 1 ? ` × ${it.quantity}` : ""}`);

      const bal = balancesFor(order)?.get(s.id) || null;
      const boxesOfOrder = (shipsByOrder[order.id] || []).filter((x) => !["cancelled", "returned"].includes(x.status)).length;
      const orderDue = Math.max(0, Math.round((orderNetTotal(order) - Number(order.total_paid ?? order.advance_payment ?? 0)) * 100) / 100);
      const boxValue = bal ? bal.total : boxesOfOrder <= 1 ? orderNetTotal(order) : null;
      const toCollect = bal ? bal.balance : boxesOfOrder <= 1 ? orderDue : null;

      const name = order.is_b2b && order.vendor_id && vendorNames[order.vendor_id]
        ? vendorNames[order.vendor_id]
        : order.delivery_name || "";

      return {
        shipmentId: s.id,
        box: s.blitz_order_code || "",
        part: boxesOfOrder > 1 ? `${(shipsByOrder[order.id] || []).findIndex((x) => x.id === s.id) + 1} of ${boxesOfOrder}` : "",
        orderId: order.id,
        orderNo: order.order_no || "",
        channel: getOrderChannelLabel(order) || "",
        products,
        pieces: pieces.map((c) => c.component_label || c.component_type).filter(Boolean),
        orderDate: order.created_at || null,
        deliveryDate: order.delivery_date || null,
        dispatchedAt: s.dispatched_at || s.created_at || null,
        name,
        phone: order.delivery_phone || "",
        address: addressOf(order),
        pincode: order.delivery_pincode || "",
        modeOfDelivery: order.mode_of_delivery || "",
        boxValue,
        toCollect,
        paymentMode: paymentModeOf(order),
        courier: s.courier_name || "",
        awb: s.awb || "",
        status: s.status || "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.dispatchedAt || "").localeCompare(String(a.dispatchedAt || "")));
}

/**
 * Load the report for [fromIso, toIso). Read-only.
 * @returns {Promise<Array>} rows from buildDispatchRows
 */
export async function fetchDispatchReport(fromIso, toIso) {
  const { data: dispatched, error } = await fetchAllRowsParallel("shipments", (q) => q
    .select("id, order_id, blitz_order_code, status, dispatched_at, created_at, courier_name, awb, shipment_components(component_id)")
    .gte("dispatched_at", fromIso)
    .lt("dispatched_at", toIso)
    .neq("status", "cancelled")
    .order("dispatched_at", { ascending: false })
    .order("id"));
  if (error) throw error;
  if (!dispatched?.length) return [];

  const orderIds = [...new Set(dispatched.map((s) => s.order_id).filter(Boolean))];
  const idChunks = chunk(orderIds, 100);
  const loadIn = (table, select) => runLimited(idChunks.map((ids) => () =>
    supabase.from(table).select(select).in("order_id", ids)));

  const [orderRes, shipRes, compRes, payRes] = await Promise.all([
    runLimited(idChunks.map((ids) => () => supabase.from("orders").select(ORDER_COLUMNS).in("id", ids))),
    loadIn("shipments", "id, order_id, status, blitz_order_code, created_at, shipment_components(component_id)"),
    loadIn("order_components", "id, order_id, item_index, component_label, component_type"),
    loadIn("order_payments", "order_id, amount, shipment_id"),
  ]);
  const flat = (results, what) => results.flatMap((r) => {
    if (r.error) throw new Error(`Could not load ${what}: ${r.error.message}`);
    return r.data || [];
  });
  const orders = flat(orderRes, "orders");
  const allShipments = flat(shipRes, "shipments").sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const components = flat(compRes, "pieces");
  // Payments are optional (older setups): a failed read only loses the per-box split.
  const payments = payRes.flatMap((r) => (r.error ? [] : r.data || []));

  const vendorIds = [...new Set(orders.filter((o) => o.is_b2b && o.vendor_id).map((o) => o.vendor_id))];
  const vendorNames = {};
  if (vendorIds.length) {
    const { data: vendors } = await supabase.from("vendors").select("id, store_brand_name").in("id", vendorIds);
    (vendors || []).forEach((v) => { vendorNames[v.id] = v.store_brand_name; });
  }

  return buildDispatchRows({ dispatched, orders, allShipments, components, payments, vendorNames });
}
