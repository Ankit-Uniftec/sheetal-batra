import { supabase } from "../lib/supabaseClient";
import config from "../config/config";

// ============================================================
// Restore the inventory an order reserved at placement, when it is
// cancelled. This is the exact reverse of the placement decrement in
// ReviewDetail.js (and CommsReviewOrder.jsx):
//   - LXRTS / Shopify-synced item (item.sync_enabled): add qty back to the
//     size-specific product_variants row, and push the increase to Shopify
//     (the shopify-inventory edge fn only has a "reduce" action, where a
//     NEGATIVE quantity increases stock — same trick InventoryDashboard uses).
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

                // Push the increase to Shopify — "reduce" with a negative qty
                // increases stock (mirrors InventoryDashboard's manual increase).
                try {
                    const response = await fetch(
                        `${config.SUPABASE_URL}/functions/v1/shopify-inventory`,
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "apikey": config.SUPABASE_KEY,
                                "Authorization": `Bearer ${config.SUPABASE_KEY}`,
                            },
                            body: JSON.stringify({
                                action: "reduce",
                                product_id: item.product_id,
                                size: item.size,
                                quantity: -qty,
                            }),
                        }
                    );
                    const result = await response.json();
                    if (!result?.success) console.error("restoreOrderInventory: Shopify increase failed:", result?.error);
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
