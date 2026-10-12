import { fetchAllRows } from "./fetchAllRows";

// "Has it left the building?" for the production screens (meeting point 34:
// "show dispatch status to production once Aryadeep dispatches the orders").
//
// Dispatch is recorded on SHIPMENTS (one row per box, created by the packaging
// scan — v2/78), never on orders.status, so the badge reads shipments. A
// cancelled or returned box does not count.

const LIVE = new Set(["dispatched", "delivered"]);

/** Every shipment, grouped by order id. One light query (no money, no client data). */
export async function fetchShipmentsByOrder() {
  const { data, error } = await fetchAllRows("shipments", (q) =>
    q.select("order_id, status, courier_name, awb, dispatched_at, delivered_at, shipment_components(component_id)"));
  if (error) throw error;
  const byOrder = {};
  for (const s of data || []) (byOrder[s.order_id] ||= []).push(s);
  return byOrder;
}

/**
 * @param {object[]} shipments   this order's shipments
 * @param {number}   [totalPieces] the order's piece count, when the screen knows it
 * @returns {null | { delivered: boolean, partial: boolean, pieces: number,
 *                    at: string|null, courier: string, awb: string }}
 *          null = nothing has left yet
 */
export function dispatchSummary(shipments, totalPieces) {
  const live = (shipments || []).filter((s) => LIVE.has(String(s.status || "").toLowerCase()));
  if (!live.length) return null;
  const latest = live.reduce((a, b) => (String(b.dispatched_at || "") > String(a.dispatched_at || "") ? b : a));
  const pieces = live.reduce((n, s) => n + (s.shipment_components?.length || 0), 0);
  return {
    delivered: live.every((s) => String(s.status).toLowerCase() === "delivered"),
    partial: !!totalPieces && pieces > 0 && pieces < totalPieces,
    pieces,
    at: latest.dispatched_at || null,
    courier: latest.courier_name || "",
    awb: latest.awb || "",
  };
}
