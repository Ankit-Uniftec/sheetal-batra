// Guards the sale-vs-revenue distinction. Internal stock movements and
// alterations carry 0 in every money column, so they never moved a revenue
// TOTAL — but they inflated every order COUNT and deflated every average.
import { isRevenueOrder, isSaleOrder, orderRevenueAmount } from "./revenue";

const sale = { status: "delivered", net_total: 100000 };
const stock = { status: "delivered", is_stock_order: true, net_total: 0 };
const alteration = { status: "delivered", is_alteration: true, net_total: 0 };

test("stock movements and alterations are revenue orders but not sales", () => {
  // They are not cancelled, so the revenue rule (correctly) admits them...
  expect(isRevenueOrder(stock)).toBe(true);
  expect(isRevenueOrder(alteration)).toBe(true);
  // ...but they are not sales, so they must never land in a count.
  expect(isSaleOrder(stock)).toBe(false);
  expect(isSaleOrder(alteration)).toBe(false);
  expect(isSaleOrder(sale)).toBe(true);
});

test("they carry no money, which is why only counts were ever wrong", () => {
  expect(orderRevenueAmount(stock)).toBe(0);
  expect(orderRevenueAmount(alteration)).toBe(0);
});

test("AOV is right once the 0-value rows leave the denominator", () => {
  const period = [sale, { ...sale }, stock, alteration];
  const revenue = period.reduce((s, o) => s + orderRevenueAmount(o), 0);
  expect(revenue).toBe(200000);

  // The bug: dividing real revenue by ALL four rows.
  expect(revenue / period.length).toBe(50000);
  // The fix: divide by actual sales.
  const sales = period.filter(isSaleOrder);
  expect(sales).toHaveLength(2);
  expect(revenue / sales.length).toBe(100000);
});

test("a cancelled sale is neither a revenue order nor a sale", () => {
  const cancelled = { status: "cancelled", net_total: 100000 };
  expect(isRevenueOrder(cancelled)).toBe(false);
  expect(isSaleOrder(cancelled)).toBe(false);
});

test("a cancelled stock movement is excluded for both reasons at once", () => {
  expect(isSaleOrder({ status: "cancelled", is_stock_order: true })).toBe(false);
});

test("the flags are only honoured when actually true", () => {
  // Guards against a false/null/absent flag being read as truthy and quietly
  // dropping real orders out of every count.
  expect(isSaleOrder({ status: "delivered", is_stock_order: false })).toBe(true);
  expect(isSaleOrder({ status: "delivered", is_alteration: null })).toBe(true);
  expect(isSaleOrder({ status: "delivered" })).toBe(true);
});

test("a null order is neither", () => {
  expect(isRevenueOrder(null)).toBe(false);
  expect(isSaleOrder(null)).toBe(false);
});
