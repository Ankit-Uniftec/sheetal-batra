import { supabase } from "../lib/supabaseClient";
import formatIndianNumber from "./formatIndianNumber";
import { markShipmentDelivered } from "./barcodeService";
import { CLOSED_STATUSES } from "./recordPayment";

// ============================================================
// "Mark Delivered" — hand an order (or some of its shipments) over to the
// customer, collecting whatever balance is due. Shared by every screen that
// offers the button (Associate dashboard cards, Order History cards that store
// managers open) so the eligibility rule and the writes never drift apart.
// ============================================================

/** Anything not already finished can be handed over. */
export function canMarkDelivered(order) {
    return !!order && !CLOSED_STATUSES.includes((order.status || "").toLowerCase());
}

/**
 * B2B and stock orders don't go through the retail delivery flow (no customer
 * balance / COD), so they skip DeliveryPaymentModal and flip straight to
 * delivered behind a simple confirm.
 */
export function isDirectDelivery(order) {
    return !!(order?.is_b2b || order?.is_stock_order);
}

/**
 * Flip an order to delivered with no payment step.
 * @returns {Promise<object>} the fields written, to merge into local state
 * @throws if the update fails
 */
export async function markOrderDelivered(order) {
    const patch = { status: "delivered", delivered_at: new Date().toISOString() };
    const { error } = await supabase.from("orders").update(patch).eq("id", order.id);
    if (error) throw error;
    return patch;
}

/**
 * Complete a retail delivery: record the balance collected, apply the COD
 * charge, and mark the handed-over shipments (or the whole legacy order)
 * delivered.
 *
 * @param {object} order
 * @param {object} delivery    exactly what DeliveryPaymentModal's onConfirm hands over
 * @param {string|null} recordedBy  actor's email
 * @returns {Promise<{patch: object, title: string, message: string}>}
 *          `patch` is the authoritative order row to merge into local state;
 *          title/message are the success wording.
 * @throws on any failed write
 */
export async function confirmDelivery(
    order,
    { paidAt, rows, deliveredAddress, finalMethod, deliveryCharge, codWaived, shipmentAllocations, isLastShipment },
    recordedBy
) {
    const allocations = Array.isArray(shipmentAllocations) ? shipmentAllocations : [];

    // Record each balance payment, tagged with the box it was collected against.
    //
    // One handover can cover several boxes, so each payment mode is split across
    // them in proportion to what each box owed — the customer hands over one
    // amount, but the ledger keeps it attributable per shipment, which is the
    // entire reason shipment_id exists.
    //
    // No allocations = an order with no shipments (legacy). shipment_id stays
    // null, which is meaningful: an order-level payment, not a guess at which
    // product it was for.
    if (Array.isArray(rows) && rows.length > 0) {
        // sp_email is not set for every login (store managers arrive without
        // it), so fall back to the authenticated user — the ledger must say who
        // took it.
        if (!recordedBy) {
            const { data } = await supabase.auth.getUser();
            recordedBy = data?.user?.email || null;
        }

        const paymentRows = [];
        const weights = allocations.map((a) => Number(a.balance) || 0);
        const weightSum = weights.reduce((s, w) => s + w, 0);

        rows.forEach((r) => {
            const amount = Number(r.amount) || 0;
            const base = {
                order_id: order.id,
                kind: "balance",
                payment_mode: r.mode,
                paid_at: paidAt,
                recorded_by: recordedBy || null,
            };

            if (allocations.length === 0 || weightSum <= 0) {
                // Nothing to split against — an order with no shipments (including
                // every order while the shipments migration has not yet run), or every
                // selected box already fully paid. Record it whole.
                //
                // shipment_id is OMITTED rather than set to null when there is nothing
                // to attribute it to: the column does not exist until migration 78 runs,
                // and Supabase rejects an insert naming an unknown column. Omitting it
                // lets this deploy safely ahead of that migration, and the column's
                // default is null anyway.
                paymentRows.push(
                    allocations.length === 1
                        ? { ...base, shipment_id: allocations[0].id, amount }
                        : { ...base, amount }
                );
                return;
            }

            // Split with a running remainder so the parts sum to the amount EXACTLY.
            // Per-row rounding would leak paise and leave a box a rupee short.
            let used = 0;
            allocations.forEach((a, i) => {
                const share = i === allocations.length - 1
                    ? Math.round((amount - used) * 100) / 100
                    : Math.round((amount * weights[i] / weightSum) * 100) / 100;
                used = Math.round((used + share) * 100) / 100;
                if (share > 0) {
                    paymentRows.push({ ...base, shipment_id: a.id, amount: share });
                }
            });
        });

        const { error: payErr } = await supabase
            .from("order_payments")
            .insert(paymentRows);
        if (payErr) throw payErr;
    }

    // Recompute net_total to include the COD charge decided at delivery.
    //
    // The goods total is read from grand_total_after_discount (never from
    // net_total): net_total is what we WRITE below, so reading it back would
    // add the charge on top of a total that already carries one — a second
    // delivery, or a retry after a partial failure, would compound ₹250 each
    // time. deliveryCharge.js is explicit that the charge is never baked in
    // at placement, so the pre-COD goods total is the correct base and this
    // stays idempotent however often it runs.
    // Deliberately NOT falling back to 0: on a legacy row with neither total
    // set, a 0 here would silently overwrite a real net_total with the bare
    // COD charge. Refuse instead — a blocked delivery is recoverable, a
    // zeroed order total is not.
    const goodsBase = order?.grand_total_after_discount ?? order?.grand_total;
    if (goodsBase == null || Number.isNaN(Number(goodsBase))) {
        throw new Error(
            "This order has no goods total (grand_total_after_discount / grand_total are both empty), " +
            "so the delivery total can't be computed. Fix the order's pricing before marking it delivered."
        );
    }
    const charge = Number(deliveryCharge) || 0;

    const deliveredAt = new Date().toISOString();
    // No money fields here. total_paid / remaining_payment are owned by
    // trg_order_payments_sync_total (77_orders_total_paid.sql), which already
    // fired on the insert above; advance_payment is frozen to the order-time
    // advance the invoice prints. Writing either from here would re-introduce
    // the two-writers drift this replaced.
    const orderUpdate = {
        delivered_mode_of_delivery: finalMethod,
        cod_charge: charge,
        net_total: Number(goodsBase) + charge,
    };
    // Only set delivered_address when the address change was flagged.
    if (deliveredAddress) orderUpdate.delivered_address = deliveredAddress;

    // Who decides the ORDER is delivered:
    //   • With a shipment — nobody here. mark_shipment_delivered() flips the box,
    //     and recalc_order_delivery() (78) promotes the order only once EVERY
    //     outstanding box has landed. Writing status here would claim the whole
    //     order arrived when one garment did.
    //   • Without one (legacy order, no shipments) — this still does it,
    //     exactly as before.
    if (allocations.length === 0) {
        orderUpdate.status = "delivered";
        orderUpdate.delivered_at = deliveredAt;
    }

    const { error: ordErr } = await supabase
        .from("orders")
        .update(orderUpdate)
        .eq("id", order.id);
    if (ordErr) throw ordErr;

    // Every selected box was physically handed over, so every one is delivered.
    // The trigger promotes the ORDER once none are left outstanding.
    for (const a of allocations) {
        const res = await markShipmentDelivered(a.id, deliveredAt);
        if (!res?.success) {
            throw new Error(res?.message || "Could not mark the shipment delivered.");
        }
    }

    // net_total just changed, so remaining_payment (derived from it) is now
    // stale — re-run the recompute, then read the authoritative row back. The
    // re-read also picks up any status the trigger just set. orderUpdate is the
    // fallback if the re-read fails, so the card still reflects the action.
    await supabase.rpc("recalc_order_total_paid", { p_order_id: order.id });
    const { data: fresh } = await supabase.from("orders").select("*").eq("id", order.id).single();

    const codNote = charge > 0
        ? `₹${formatIndianNumber(charge)} COD charge applied. `
        : (codWaived ? "COD charge waived. " : "");
    const boxes = allocations.length;
    const partial = boxes > 0 && !isLastShipment;

    return {
        patch: { ...orderUpdate, ...(fresh || {}) },
        title: partial ? "Shipment Delivered" : "Order Delivered",
        message: partial
            ? `${codNote}${boxes > 1 ? `${boxes} shipments` : "Shipment"} delivered. The order stays open until its remaining shipments are delivered.`
            : `${codNote}Order marked as delivered.`,
    };
}
