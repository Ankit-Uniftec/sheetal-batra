import { supabase } from "../lib/supabaseClient";
import { getOrderChannelKey } from "./barcodeService";
import { changeShopifyStock } from "./shopifyInventory";

// ============================================================
// Restore the inventory an order reserved at placement, when it is
// cancelled. This is the exact reverse of the placement decrement in
// ReviewDetail.js (and CommsReviewOrder.jsx):
//   - LXRTS / Shopify-synced item (item.sync_enabled): add qty back to the
//     size-specific product_variants row, and push the increase to Shopify
//     (changeShopifyStock, +qty).
//   - Normal / custom item: add qty back to products.inventory.
//
// Non-blocking by design: any failure is logged and swallowed so it can
// never prevent the cancellation itself from completing. Call this ONCE,
// only when an order's status actually flips to "cancelled" (the caller
// guards on the pre-update status), so re-cancelling can't double-add.
// ============================================================
export async function restoreOrderInventory(order) {
    if (!order || !Array.isArray(order.items)) return;
    // Stock orders are procurement (they ADD warehouse stock, not reserve a
    // customer's item), so they never decremented sellable inventory at
    // placement — restoring on their cancel would wrongly inflate counts. Skip.
    if (order.is_stock_order === true) return;
    // Shopify (website) orders never decremented anything from here: Shopify
    // decremented its OWN stock at checkout, and ingestion deliberately skips
    // the placement decrement (it mirrors Shopify's numbers down instead).
    // Shopify also restocks its own cancellations. Restoring here would push a
    // second increase and inflate the storefront's stock. Skip entirely.
    if (getOrderChannelKey(order) === "shopify") return;
    try {
        for (const item of order.items) {
            if (!item?.product_id) continue;
            const qty = item.quantity || 1;

            if (item.sync_enabled) {
                // LXRTS / Shopify-synced — variant-level inventory.
                const { data: variants, error: fetchError } = await supabase
                    .from("product_variants")
                    .select("id, inventory, size")
                    .eq("product_id", item.product_id)
                    .eq("size", item.size)
                    .limit(1);
                if (fetchError) {
                    console.error("restoreOrderInventory: variant fetch error:", fetchError);
                } else if (variants && variants.length > 0) {
                    const variant = variants[0];
                    const newInventory = (variant.inventory || 0) + qty;
                    const { error: updateError } = await supabase
                        .from("product_variants")
                        .update({ inventory: newInventory })
                        .eq("id", variant.id);
                    if (updateError) console.error("restoreOrderInventory: variant update error:", updateError);
                }

                // Push the increase to Shopify (+qty). Logged by the function;
                // a failure is listed for retry and never blocks the cancel.
                try {
                    const sync = await changeShopifyStock(item.product_id, item.size, qty, {
                        source: "order-cancelled", orderNo: order.order_no,
                    });
                    if (!sync.ok) console.error("restoreOrderInventory: Shopify increase failed:", sync.error);
                } catch (shopifyErr) {
                    console.error("restoreOrderInventory: Shopify sync error:", shopifyErr);
                }
            } else {
                // Normal / custom — product-level inventory.
                const { data: productData, error: fetchError } = await supabase
                    .from("products")
                    .select("inventory")
                    .eq("id", item.product_id)
                    .single();
                if (fetchError) {
                    console.error("restoreOrderInventory: product fetch error:", fetchError);
                } else if (productData) {
                    const newInventory = (productData.inventory || 0) + qty;
                    const { error: updateError } = await supabase
                        .from("products")
                        .update({ inventory: newInventory })
                        .eq("id", item.product_id);
                    if (updateError) console.error("restoreOrderInventory: product update error:", updateError);
                }
            }
        }
    } catch (err) {
        console.error("restoreOrderInventory: unexpected error (cancellation not blocked):", err);
    }
}
