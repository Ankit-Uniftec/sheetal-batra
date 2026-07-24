// Accounts line-item builder — shared by the leadership accounts tabs
// (Admin / CEO / GM). Explodes each order into per-product line items with a
// GST(5%) accounting decomposition and a proportionally-allocated order discount.
//
// Extracted verbatim from the three identical inline `accountsLineItems` memos
// (AdminDashboard / CeoDashboard / GMDashboard). Pure function: it takes the
// already-scoped order array as a param and reads no module or component state,
// so each dashboard passes its own base array (Admin: nonCommsOrders; CEO/GM:
// orders) and the numbers stay byte-identical to before.

// LXRTS (Shopify-synced) orders are excluded from the accounts view.
const isLxrtsOrder = (order) => order?.items?.[0]?.sync_enabled === true;

// Actual person name (not store name) for the salesperson field.
const getOrderSalesperson = (order) => {
    // For B2B orders, use merchandiser_name or approved_by as the person
    if (order.is_b2b || (order.salesperson_store || "").toLowerCase() === "b2b") {
        return order.merchandiser_name || order.salesperson || null;
    }
    return order.salesperson || null;
};

export function buildAccountsLineItems(orders) {
    const items = [];
    const GST_RATE = 0.05;
    orders.forEach(order => {
        if (isLxrtsOrder(order)) return;
        const orderItems = order.items || [];
        // Discount is allocated proportionally across line items by their
        // GST-inclusive gross — same basis as `gross` so the ratio is unit-free.
        const orderGrossSum = orderItems.reduce(
            (s, it) => s + Number(it.price || 0) * Number(it.quantity || 1), 0
        );
        const orderDiscount = Number(order.discount_amount || 0);
        orderItems.forEach((item, idx) => {
            const productPrice = Number(item.price || 0);
            const quantity = Number(item.quantity || 1);
            // item.price is the GST-inclusive MRP shown on the customer invoice.
            const grossValue = productPrice * quantity;
            const discountRatio = orderGrossSum > 0 ? grossValue / orderGrossSum : 0;
            const productDiscount = Math.min(grossValue, orderDiscount * discountRatio);
            // Invoice value = what the customer was billed for this line (GST-inclusive).
            const invoiceValue = Math.max(0, grossValue - productDiscount);
            // Strip GST out to get the accounting decomposition.
            const taxableValue = invoiceValue / (1 + GST_RATE);
            const gst = invoiceValue - taxableValue;

            items.push({
                id: `${order.id}-${idx}`, order_no: order.order_no, order_date: order.created_at,
                sa_name: getOrderSalesperson(order) || "-", client_name: order.delivery_name || "-",
                product_name: item.product_name || "-",
                gross_value: Math.round(grossValue * 100) / 100, discount: Math.round(productDiscount * 100) / 100,
                taxable_value: Math.round(taxableValue * 100) / 100, gst: Math.round(gst * 100) / 100,
                invoice_value: Math.round(invoiceValue * 100) / 100, quantity,
                status: order.status || "order_received", delivery_date: item.delivery_date || order.delivery_date,
                store: order.salesperson_store || "-", payment_mode: order.payment_mode || "-",
            });
        });
    });
    return items;
}
