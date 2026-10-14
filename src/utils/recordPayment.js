import { supabase } from "../lib/supabaseClient";
import { uploadPaymentProof } from "./paymentProofs";
import formatIndianNumber from "./formatIndianNumber";

// ============================================================
// The standalone "Update Payment" — record money collected against an order's
// balance, independent of delivery. Shared by every screen that offers the
// button (Associate dashboard cards, Order History cards that store managers
// open) so the eligibility rule and the ledger write never drift apart.
// ============================================================

export const CLOSED_STATUSES =["delivered", "cancelled", "exchange_return", "revoked"];

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
 * A row may carry an optional `proofFile` (meeting point 26). Proofs are
 * uploaded AFTER the ledger insert and linked to their own payment row; a
 * proof that fails to upload never undoes the payment — it is reported back
 * in `proofFailures` so the caller can say so (and it can be added later on
 * the order page).
 *
 * @param {object} order
 * @param {{paidAt: string, rows: {mode: string, amount: number|string, proofFile?: File}[]}} payment
 *        exactly what UpdatePaymentModal's onConfirm hands over
 * @param {string|null} recordedBy  actor's email
 * @returns {Promise<{collected: number, fresh: object|null, proofsSaved: number, proofFailures: string[]}>}
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
    const { data: inserted, error } = await supabase.from("order_payments").insert(
        (rows || []).map((r) => ({
            order_id: order.id,
            kind: "balance",
            payment_mode: r.mode,
            amount: r.amount,
            paid_at: paidAt,
            recorded_by: recordedBy || null,
        }))
    ).select("id, payment_mode, amount");
    if (error) throw error;

    const { proofsSaved, proofFailures } = await uploadRowProofs(order, rows || [], inserted || [], recordedBy);

    const { data: fresh } = await supabase.from("orders").select("*").eq("id", order.id).single();
    return { collected, fresh: fresh || null, proofsSaved, proofFailures };
}

/**
 * Upload each row's proof and link it to the ledger row it proves. The
 * inserted rows come back in insert order; each pairing is still checked by
 * mode + amount, falling back to a search, so a proof can never be linked to
 * the wrong payment. One failed file does not stop the others.
 */
async function uploadRowProofs(order, rows, inserted, uploadedBy) {
    let proofsSaved = 0;
    const proofFailures = [];
    const used = new Set();
    const same = (r, p) => p && p.payment_mode === r.mode && Number(p.amount) === Number(r.amount);
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.proofFile) continue;
        let match = !used.has(i) && same(r, inserted[i]) ? i : inserted.findIndex((p, j) => !used.has(j) && same(r, p));
        if (match < 0) match = null;
        if (match != null) used.add(match);
        try {
            await uploadPaymentProof({
                order,
                checkpoint: "balance",
                file: r.proofFile,
                uploadedBy,
                paymentId: match != null ? inserted[match].id : null,
                paymentMode: r.mode,
                amount: r.amount,
            });
            proofsSaved++;
        } catch (err) {
            console.error("Payment proof upload failed (payment WAS recorded):", err);
            proofFailures.push(`${r.proofFile.name} (${r.mode} ₹${r.amount})`);
        }
    }
    return { proofsSaved, proofFailures };
}

/**
 * The popup after Update Payment, shared by every caller so the wording (and
 * the proof report) is the same everywhere. A proof that failed to upload
 * turns it into a warning that names the file: the payment IS recorded, the
 * proof can be added later from the order page.
 *
 * @param {{collected:number, fresh:object|null, proofsSaved?:number, proofFailures?:string[]}} result
 * @returns {{type:string, title:string, message:string}}
 */
export function paymentRecordedPopup({ collected, fresh, proofsSaved = 0, proofFailures = [] }) {
    const newRemaining = Number(fresh?.remaining_payment) || 0;
    // Quote the balance the DB computed, not one guessed here.
    let message = newRemaining > 0
        ? `₹${formatIndianNumber(collected)} recorded. Balance now ₹${formatIndianNumber(newRemaining)}.`
        : `₹${formatIndianNumber(collected)} recorded. Order is now fully paid.`;
    if (proofsSaved) message += ` ${proofsSaved} payment proof${proofsSaved === 1 ? "" : "s"} attached.`;
    if (proofFailures.length) {
        message += ` These proofs could not be uploaded: ${proofFailures.join(", ")}. Add them from the order details page.`;
        return { type: "warning", title: "Payment Recorded — proof not saved", message };
    }
    return { type: "success", title: "Payment Recorded", message };
}
