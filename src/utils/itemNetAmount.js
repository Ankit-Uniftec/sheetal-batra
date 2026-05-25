// Helpers for splitting an order's gross/discount/final amounts across line items.
// The order-level `discount_amount` belongs to the WHOLE order, not any single item,
// so per-product reports must allocate it proportionally to each item's gross value.
//
// Important — both `item.price` and `discount_amount` are GST-inclusive numbers
// (item.price is the MRP, discount_amount is what we knocked off the MRP). The
// allocation basis must be on the SAME basis (item gross sum), not on the
// GST-stripped `subtotal` column — otherwise the ratio comes out > 1 and the
// discount gets inflated by the GST rate.
//
// Example: a ₹10,000 kurta and a ₹5,000 saree on one order with ₹3,000 off.
//   - basis    = 15,000  (sum of item.price * quantity)
//   - kurta:    gross 10000, ratio 0.667, discount 2000, final 8000
//   - saree:    gross  5000, ratio 0.333, discount 1000, final 4000
//   - totals:   gross 15000, discount 3000, final 12000 (matches order.grand_total - discount)
//
// Use itemAmounts() for tables/CSVs that want all three numbers per item.
// Use itemFinalAmount() for charts that only need the one net number.

const grossOf = (item) =>
    Number(item?.price || 0) * Number(item?.quantity || 1);

export const orderItemsGross = (order) =>
    (order?.items || []).reduce((s, it) => s + grossOf(it), 0);

export const itemAmounts = (order, item) => {
    const gross = grossOf(item);
    const basis = orderItemsGross(order);
    const orderDiscount = Number(order?.discount_amount || 0);
    const ratio = basis > 0 ? gross / basis : 0;
    const discount = Math.min(gross, orderDiscount * ratio);
    const final = Math.max(0, gross - discount);
    return { gross, discount, final };
};

export const itemFinalAmount = (order, item) => itemAmounts(order, item).final;
