// Guards the packaging desk export (meeting point 43): one row per product,
// pieces placed in the right column, and the payment columns per channel.
import { buildPackagingExportRows, formatPaymentMode, paymentStatus, EXPORT_HEADERS } from "./packagingExport";

const deps = {
  channelLabel: (o) => (o.order_no.includes("SHOPIFY") ? "Shopify" : "Delhi Store"),
  stageLabel: (c) => c.current_stage,
  warehouseDate: () => "20-10-2026",
  formatDate: () => "08-10-2026",
  isShopify: (o) => o.order_no.includes("SHOPIFY"),
};
const col = (name) => EXPORT_HEADERS.indexOf(name);

test("one row per product, charge lines skipped, pieces in their own columns", () => {
  const order = {
    id: "o1", order_no: "SB-DLC-1026-000001",
    items: [
      { product_name: "Kurta Set", quantity: 1, size: "M", top_color: { name: "Red" }, bottom_color: { name: "Red" } },
      { product_name: "Customisation", is_charge: true },
      { product_name: "Dupatta", quantity: 2, size: "Free", top_color: "Blue", bottom_color: "" },
    ],
  };
  const comps = { o1: [
    { item_index: 0, component_type: "top", current_stage: "Embroidery", is_outside_wh: false },
    { item_index: 0, component_type: "bottom", current_stage: "Dyeing", is_outside_wh: true, vendor_name: "Shah" },
    { item_index: 2, component_type: "dupatta", current_stage: "QC", is_outside_wh: false },
  ] };
  const money = { o1: { remaining_payment: 0, total_paid: 5000, payment_mode: "UPI", po_number: "PO-9" } };
  const rows = buildPackagingExportRows([order], comps, money, deps);
  expect(rows[0][col("Shopify No / PO No")]).toBe("PO-9");
  expect(rows[0][col("Payment")]).toBe("Paid");
  expect(rows[0][col("Mode of Payment")]).toBe("UPI");
  expect(rows).toHaveLength(2);
  expect(rows[0][col("Product Name")]).toBe("Kurta Set");
  expect(rows[0][col("Color")]).toBe("Red");
  expect(rows[0][col("Top — Stage")]).toBe("Embroidery · Internal");
  expect(rows[0][col("Bottom — Stage")]).toBe("Dyeing · External — Shah");
  expect(rows[0][col("Dupatta — Stage")]).toBe("—");
  expect(rows[1][col("Product Name")]).toBe("Dupatta");
  expect(rows[1][col("Dupatta — Stage")]).toBe("QC · Internal");
  expect(rows[1][col("Top — Stage")]).toBe("—");
  expect(rows[0]).toHaveLength(EXPORT_HEADERS.length);
});

test("several extras are listed together", () => {
  const order = { id: "o2", order_no: "SB-DLC-1", items: [{ product_name: "Set" }] };
  const comps = { o2: [
    { item_index: 0, component_type: "extra", component_label: "Potli", current_stage: "Stitching" },
    { item_index: 0, component_type: "extra", component_label: "Belt", current_stage: "QC", is_outside_wh: true, vendor_name: "Rana" },
  ] };
  const [row] = buildPackagingExportRows([order], comps, {}, deps);
  expect(row[col("Extras — Stage")]).toBe("Potli: Stitching · Internal | Belt: QC · External — Rana");
});

test("split payment modes are spelled out", () => {
  expect(formatPaymentMode({ is_split_payment: true, payment_mode: '[{"mode":"UPI","amount":"100"},{"mode":"Cash","amount":"17000"}]' }))
    .toBe("UPI ₹100 + Cash ₹17,000");
  expect(formatPaymentMode({ payment_mode: "Gokwik UPI" })).toBe("Gokwik UPI");
  expect(formatPaymentMode({ payment_mode: null })).toBe("");
});

test("payment status per channel", () => {
  expect(paymentStatus({ remaining_payment: 0, total_paid: 100 }, { isShopify: false })).toEqual({ status: "Paid", balance: "₹0" });
  expect(paymentStatus({ remaining_payment: 38500, total_paid: 30000 }, { isShopify: false })).toEqual({ status: "Partially paid", balance: "₹38,500" });
  expect(paymentStatus({ remaining_payment: 5000, total_paid: 0, advance_payment: 0 }, { isShopify: false })).toEqual({ status: "Unpaid", balance: "₹5,000" });
  expect(paymentStatus({ shopify_financial_status: "PAID" }, { isShopify: true }).status).toBe("Paid");
  expect(paymentStatus({ shopify_financial_status: "PENDING" }, { isShopify: true })).toEqual({ status: "Unpaid", balance: "" });
  expect(paymentStatus({ remaining_payment: 9 }, { isShopify: false, noCustomerPayment: true }).status).toBe("N/A");
});

test("stock and Comms orders show N/A for payment and mode", () => {
  const rows = buildPackagingExportRows(
    [{ id: "s1", order_no: "SB-STOCK-1", is_stock_order: true, items: [{ product_name: "X" }] }],
    {}, { s1: { remaining_payment: 9000, payment_mode: "Cash" } }, deps);
  expect(rows[0][col("Payment")]).toBe("N/A");
  expect(rows[0][col("Balance")]).toBe("");
  expect(rows[0][col("Mode of Payment")]).toBe("N/A");
});
