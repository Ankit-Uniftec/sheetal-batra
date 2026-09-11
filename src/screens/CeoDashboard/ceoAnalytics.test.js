// Guards the CEO dashboard money rules. The dashboard reports a gross "Total
// Revenue" card and a net "Net SB Revenue" card side by side, so the two must
// stay distinct while every OTHER block reports net.
import { isRevenueOrder } from "../../utils/revenue";
import { totalNetSbRevenue } from "../../utils/exhibitionService";

const grossOf = (o) =>
  Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0);

test("the gross and net cards differ exactly by the exhibition commission", () => {
  const orders = [
    { exhibition_id: "e1", net_total: 100000, net_sb_revenue: 80000 },
    { net_total: 50000 },
  ];
  const gross = orders.reduce((s, o) => s + grossOf(o), 0);
  const net = totalNetSbRevenue(orders);
  expect(gross).toBe(150000);
  expect(net).toBe(130000);
  // The 20000 gap is the partner's commission — collapsing these two cards to
  // one number would erase a real distinction the CEO reads.
  expect(gross - net).toBe(20000);
});

test("a cancelled order is excluded from revenue but still counts as cancelled", () => {
  const period = [
    { status: "delivered", net_total: 30000 },
    { status: "cancelled", net_total: 90000 },
  ];
  const revenue = period.filter(isRevenueOrder);
  expect(revenue).toHaveLength(1);
  expect(totalNetSbRevenue(revenue)).toBe(30000);
  // The cancelled card reads from the full slice, which is why it survives.
  expect(period.filter((o) => !isRevenueOrder(o))).toHaveLength(1);
});

test("returned and refunded orders are caught, not just cancelled ones", () => {
  // enhancedAnalytics used a hand-rolled status !== "cancelled" that let these
  // through, so bottom products ranked on sales that had been undone.
  expect(isRevenueOrder({ status: "returned", net_total: 1 })).toBe(false);
  expect(isRevenueOrder({ status: "revoked", net_total: 1 })).toBe(false);
  expect(isRevenueOrder({ status: "delivered", refund_status: "processed" })).toBe(false);
  expect(isRevenueOrder({ status: "delivered" })).toBe(true);
});

test("AOV divides revenue by the same set that produced it", () => {
  const period = [
    { status: "delivered", net_total: 40000 },
    { status: "delivered", net_total: 20000 },
    { status: "cancelled", net_total: 99999 },
  ];
  const valid = period.filter(isRevenueOrder);
  const aov = totalNetSbRevenue(valid) / valid.length;
  // Dividing 60000 by all THREE orders would have reported 20000.
  expect(aov).toBe(30000);
});

test("B2B accounts group by vendor id, not by free-text delivery_name", () => {
  const vendors = [{ id: "v1", store_brand_name: "Aza Fashions" }];
  const orders = [
    { vendor_id: "v1", delivery_name: "Aza", net_total: 10000 },
    { vendor_id: "v1", delivery_name: "AZA Fashions", net_total: 15000 },
  ];
  const byKey = {};
  orders.forEach((o) => {
    const vendor = o.vendor_id ? vendors.find((v) => v.id === o.vendor_id) : null;
    const key = vendor?.id || (o.delivery_name || "").trim().toLowerCase() || "unknown";
    const name = vendor?.store_brand_name || o.delivery_name || "Unknown";
    if (!byKey[key]) byKey[key] = { name, sales: 0, orders: 0 };
    byKey[key].sales += totalNetSbRevenue([o]);
    byKey[key].orders += 1;
  });
  const rows = Object.values(byKey);
  // Two spellings, one account: keying on delivery_name split this into two
  // rows of 10000 and 15000, so neither showed the real 25000.
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ name: "Aza Fashions", sales: 25000, orders: 2 });
});
