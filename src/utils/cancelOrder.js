import { supabase } from "../lib/supabaseClient";
import { restoreOrderInventory } from "./restoreOrderInventory";
import { NOTIFICATION_TYPES, sendNotification } from "./notificationService";

// ============================================================
// The one place an order gets cancelled.
//
// Lifted verbatim out of B2bMerchandiserDashboard's handleConfirmCancel, which
// was the only complete implementation in the app. Cancelling is five steps
// that must all happen, and every hand-rolled copy has dropped at least one:
// the Admin / CEO / COO status dropdowns write status='cancelled' with no
// reason, no inventory restore and (in two of three) no cancelled_at at all.
// Adding the PM's button meant either a sixth copy or this. This is smaller.
//
// Order matters: the status write comes first and throws on failure, so a
// failed cancel can't restore inventory for an order that is still live.
// Everything after it is best-effort — a notification that doesn't send must
// not make the caller think the cancellation failed, because it didn't.
// ============================================================

const orderAmount = (o) =>
    Number(o?.net_total ?? o?.grand_total_after_discount ?? o?.grand_total ?? 0);

// A cancel and a revoke are the same physical event — the garment is not going
// to be delivered — so both must take the pieces off the floor. They differ
// only in the row they write and who gets told, which is what `status` and
// `notify` cover.
const TERMINAL_STATUSES = new Set(["cancelled", "revoked"]);

/**
 * Cancel (or revoke) an order: status + reason, take its pieces out of
 * production, restore inventory, reverse B2B buyout credit, notify production.
 *
 * @param {object}  order       the full orders row (needs id, order_no, items, status)
 * @param {string}  reason      free text, required — callers validate before calling
 * @param {object} [opts]
 * @param {string} [opts.cancelledBy]  display name for the notification
 * @param {string} [opts.email]        actor's email, stamped on the component ledger
 * @param {string} [opts.status]       "cancelled" (default) or "revoked"
 * @param {boolean}[opts.notify]       false to skip the ORDER_CANCELLED notification
 *                                     when the caller sends its own (OrderHistory
 *                                     attaches the customer PDF; revoke has its own pair)
 * @param {boolean}[opts.restoreInventory] false for stock orders, which never
 *                                     reserved sellable inventory at placement
 * @returns {Promise<{cancelledComponents: number}>}
 * @throws if the status write itself fails — the order is NOT cancelled
 */
export async function cancelOrder(order, reason, opts = {}) {
    if (!order?.id) throw new Error("cancelOrder: no order");
    const trimmed = (reason || "").trim();
    if (!trimmed) throw new Error("A cancellation reason is required.");
    const status = opts.status === "revoked" ? "revoked" : "cancelled";

    // Read the PRE-update status: re-cancelling an already-terminal order must
    // not add its inventory back a second time.
    const wasCancelled = TERMINAL_STATUSES.has((order.status || "").toLowerCase());

    // 1. The cancellation itself. Throws — everything below depends on it.
    const patch = {
        status,
        cancellation_reason: trimmed,
        cancelled_at: new Date().toISOString(),
    };
    if (status === "revoked") patch.revoked_at = new Date().toISOString();
    const { error } = await supabase.from("orders").update(patch).eq("id", order.id);
    if (error) throw error;

    // 2. Take the garments out of production (93_cancel_order_components.sql).
    //    Without this the factory floor keeps scanning a cancelled order and the
    //    SLA escalations keep firing. Non-fatal: the order IS cancelled, and a
    //    stranded component is recoverable by re-running the RPC.
    let cancelledComponents = 0;
    if (!wasCancelled) {
        try {
            const { data, error: compErr } = await supabase.rpc("cancel_order_components", {
                p_order_id: order.id,
                p_cancelled_by: opts.email || null,
            });
            if (compErr) throw compErr;
            cancelledComponents = data?.cancelled_components || 0;
        } catch (e) {
            console.error("cancelOrder: components not deactivated (order still cancelled):", e);
        }
    }

    // 3. Inventory this order reserved at placement. Self-skips stock and
    //    Shopify orders; already non-blocking internally.
    if (!wasCancelled && opts.restoreInventory !== false) await restoreOrderInventory(order);

    // 4. B2B Buyout credit — only an APPROVED buyout ever added to the vendor's
    //    used credit, so only that combination reverses.
    if (!wasCancelled && order.is_b2b && order.b2b_order_type === "Buyout"
        && order.vendor_id && order.approval_status === "approved") {
        try {
            const { data: v } = await supabase
                .from("vendors").select("current_credit_used").eq("id", order.vendor_id).single();
            await supabase.from("vendors").update({
                current_credit_used: Math.max(0, Number(v?.current_credit_used || 0) - orderAmount(order)),
            }).eq("id", order.vendor_id);
        } catch (creditErr) {
            console.error("cancelOrder: credit reversal failed (order still cancelled):", creditErr);
        }
    }

    // 5. Tell production. PM is a static recipient; the channel-correct head is
    //    resolved by designation, never hardcoded. No customer WhatsApp.
    //    Skipped when the caller sends its own richer notification.
    if (opts.notify === false) return { cancelledComponents };

    let headEmail = null;
    try {
        const { data: he } = await supabase.rpc("get_production_head_email", { p_order_id: order.id });
        headEmail = he || null;
    } catch (e) { /* non-fatal — PM still gets it */ }
    sendNotification(NOTIFICATION_TYPES.ORDER_CANCELLED, {
        orderId: order.id,
        orderNo: order.order_no,
        metadata: {
            client_name: order.delivery_name,
            source: order.salesperson_store,
            cancelled_by: opts.cancelledBy || "",
        },
        extraRecipients: headEmail ? [{ email: headEmail.toLowerCase(), channel: "in_app" }] : [],
    }).catch((err) => console.error("cancelOrder: notification error:", err));

    return { cancelledComponents };
}

export default cancelOrder;
