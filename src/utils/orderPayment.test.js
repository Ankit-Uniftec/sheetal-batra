import { orderPayment } from "./orderPayment";

test("website order → the Shopify badge, no amounts", () => {
  const p = orderPayment({ shopify_financial_status: "PAID" }, { isShopify: true });
  expect(p).toMatchObject({ label: "Fully Paid", variant: "success", total: null, balance: null });
  expect(orderPayment({ shopify_financial_status: "PENDING", shopify_tags: ["COD"] }, { isShopify: true }).label).toBe("COD");
});

test("store order → status with amounts and mode", () => {
  const p = orderPayment(
    { net_total: 20000, total_paid: 5000, remaining_payment: 15000, payment_mode: "UPI" },
    { isShopify: false });
  expect(p).toEqual({ label: "Partially paid", variant: "warning", total: 20000, paid: 5000, balance: 15000, mode: "UPI" });
  expect(orderPayment({ net_total: 100, total_paid: 100, remaining_payment: 0 }, { isShopify: false }).label).toBe("Paid");
  expect(orderPayment({ net_total: 100, total_paid: 0, remaining_payment: 100 }, { isShopify: false }).variant).toBe("danger");
});

test("stock and Comms orders carry no customer payment", () => {
  expect(orderPayment({ is_stock_order: true }, { isShopify: false }).label).toBe("No payment (internal)");
  expect(orderPayment({ is_comms: true, remaining_payment: 500 }, { isShopify: false }).total).toBeNull();
});
