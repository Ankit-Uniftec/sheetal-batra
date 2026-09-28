import { supabase } from "../lib/supabaseClient";

// ============================================================
// The standalone "Update Payment" — record money collected against an order's
// balance, independent of delivery. Shared by every screen that offers the
// button (Associate dashboard cards, Order History cards that store managers
// open) so the eligibility rule and the ledger write never drift apart.
// ============================================================

const CLOSED_STATUSES = ["delivered", "cancelled", "exchange_return", "revoked"];

/**
 * Retail orders that still owe money and aren't finished. B2B/stock orders
 * don't collect a balance this way.
 */
export function canUpdatePayment(order) {
    if (!order || order.is_b2b || order.is_stock_order) return false;
    if (CLOSED_STATUSES.includes((order.status || "").toLowerCase())) return false;
    const orderTotal = Number(order.net_total ?? order.grand_total_after_discount ?? order.grand_total ?? 0);
    // total_paid, not advance_payment: the latter is frozen at the order-time
    // advance, so it would never shrink the balance and this button would never
    // go away on a fully-paid order. Falls back for rows predating the backfill.
    const paidSoFar = Number(order.total_paid ?? order.advance_payment) || 0;
    return orderTotal - paidSoFar > 0;
}

/**
 * Insert the collected rows into order_payments and return the re-read order.
 *
 * No orders.update at all. Adding into advance_payment used to make the
 * customer invoice print an advance larger than the customer ever advanced.
 * total_paid and remaining_payment are maintained by trg_order_payments_sync_total
 * (77_orders_total_paid.sql) off this insert; advance_payment stays frozen at
 * the order-time figure. Status is NOT changed — payment only.
 *
 * @param {object} order
 * @param {{paidAt: string, rows: {mode: string, amount: number|string}[]}} payment
 *        exactly what UpdatePaymentModal's onConfirm hands over
 * @param {string|null} recordedBy  actor's email
 * @returns {Promise<{collected: number, fresh: object|null}>}
 * @throws if the insert fails — nothing was recorded
 */
export async function recordPayment(order, { paidAt, rows }, recordedBy) {
    const collected = (rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    // sp_email is not set for every login (store managers arrive without it),
    // so fall back to the authenticated user — the ledger must say who took it.
    if (!recordedBy) {
        const { data } = await supabase.auth.getUser();
        recordedBy = data?.user?.email || null;
    }
    const { error } = await supabase.from("order_payments").insert(
        (rows || []).map((r) => ({
            order_id: order.id,
            kind: "balance",
            payment_mode: r.mode,
            amount: r.amount,
            paid_at: paidAt,
            recorded_by: recordedBy || null,
        }))
    );
    if (error) throw error;

    const { data: fresh } = await supabase.from("orders").select("*").eq("id", order.id).single();
    return { collected, fresh: fresh || null };
}
