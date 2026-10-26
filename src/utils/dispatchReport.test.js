import { buildDispatchRows, paymentModeOf } from "./dispatchReport";

const order = (over = {}) => ({
  id: "o1", order_no: "SB-DLC-1026-000001", created_at: "2026-10-01T10:00:00", delivery_date: "2026-10-30",
  delivery_name: "Asha", delivery_address: "12 MG Road", delivery_city: "Delhi", delivery_pincode: "110001",
  mode_of_delivery: "Home Delivery", payment_mode: "UPI", net_total: 30000, total_paid: 10000, advance_payment: 10000,
  items: [
    { product_name: "Kurta Set", size: "M", quantity: 1, price: 20000 },
    { product_name: "Lehenga", size: "S", quantity: 1, price: 10000 },
  ],
  ...over,
});

const comps = [
  { id: "c1", order_id: "o1", item_index: 0, component_label: "Kurta" },
  { id: "c2", order_id: "o1", item_index: 0, component_label: "Salwar" },
  { id: "c3", order_id: "o1", item_index: 1, component_label: "Lehenga" },
];

test("one row per box: an order shipped in two parts shows twice, each with its own money", () => {
  const s1 = { id: "s1", order_id: "o1", status: "dispatched", blitz_order_code: "SB-DLC-1026-000001-S1", dispatched_at: "2026-10-20T10:00:00Z", created_at: "2026-10-20T10:00:00Z", shipment_components: [{ component_id: "c1" }, { component_id: "c2" }] };
  const s2 = { id: "s2", order_id: "o1", status: "dispatched", blitz_order_code: "SB-DLC-1026-000001-S2", dispatched_at: "2026-10-21T10:00:00Z", created_at: "2026-10-21T10:00:00Z", shipment_components: [{ component_id: "c3" }] };
  const rows = buildDispatchRows({ dispatched: [s1, s2], orders: [order()], allShipments: [s1, s2], components: comps, payments: [] });
  expect(rows).toHaveLength(2);
  const [r2, r1] = rows; // newest first
  expect(r1).toMatchObject({ box: "SB-DLC-1026-000001-S1", part: "1 of 2", products: ["Kurta Set (M)"], pieces: ["Kurta", "Salwar"], pincode: "110001", paymentMode: "UPI" });
  expect(r2).toMatchObject({ part: "2 of 2", products: ["Lehenga (S)"] });
  // ₹10,000 advance split 2:1 across the boxes → to collect 20000-6666.67 and 10000-3333.33
  expect(r1.boxValue).toBe(20000);
  expect(r2.boxValue).toBe(10000);
  expect(Math.round(r1.toCollect + r2.toCollect)).toBe(20000);
});

test("a single-box order whose prices don't add up still shows the order balance", () => {
  const s = { id: "s1", order_id: "o1", status: "dispatched", dispatched_at: "2026-10-20T10:00:00Z", created_at: "2026-10-20T10:00:00Z", shipment_components: [{ component_id: "c1" }] };
  const rows = buildDispatchRows({ dispatched: [s], orders: [order({ net_total: 99999 })], allShipments: [s], components: comps });
  expect(rows[0]).toMatchObject({ boxValue: 99999, toCollect: 89999 });
});

test("B2B rows show the partner's name", () => {
  const s = { id: "s1", order_id: "o1", status: "dispatched", dispatched_at: "x", shipment_components: [] };
  const rows = buildDispatchRows({ dispatched: [s], orders: [order({ is_b2b: true, vendor_id: "v1", delivery_name: "" })], allShipments: [s], vendorNames: { v1: "Agashe" } });
  expect(rows[0].name).toBe("Agashe");
});

test("payment mode in words", () => {
  expect(paymentModeOf({ shopify_order_id: "1", shopify_financial_status: "PAID" })).toBe("Prepaid (website)");
  expect(paymentModeOf({ shopify_order_id: "1", shopify_financial_status: "PENDING" })).toBe("COD (website)");
  expect(paymentModeOf({ payment_mode: "Cash", is_split_payment: true })).toBe("Split (Cash)");
  expect(paymentModeOf({ is_stock_order: true })).toBe("Internal stock");
  expect(paymentModeOf({ is_b2b: true, b2b_order_type: "Partner Gifting" })).toBe("Gift (no charge)");
  expect(paymentModeOf({ is_b2b: true, b2b_order_type: "Buyout" })).toBe("B2B (invoice)");
});
