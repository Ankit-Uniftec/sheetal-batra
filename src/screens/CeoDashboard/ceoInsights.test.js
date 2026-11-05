import {
  pctChange, shortInr, monthPace, channelMovers, productBoard, sizeBoard, weekdayPattern, clientMix,
  lapsedVips, aftercare, buildAttention, buildHighlights, headline, revenueSeries, buildBrief,
} from "./ceoInsights";

jest.mock("../../lib/supabaseClient", () => ({ supabase: {} }));

const NOW = new Date(2026, 10, 15, 12);
const order = (over = {}) => ({
  id: over.id || Math.random().toString(36), order_no: "SB-DLC-1126-000001", status: "order_received",
  net_total: 1000, grand_total: 1000, created_at: new Date(2026, 10, 10).toISOString(),
  delivery_phone: "+91", delivery_name: "A", items: [{ product_name: "Aqsha", price: 1000, quantity: 1, size: "M" }],
  ...over,
});
const always = () => true;

test("percent change has no answer when there is nothing to compare with", () => {
  expect(pctChange(150, 100)).toBe(50);
  expect(pctChange(50, 100)).toBe(-50);
  expect(pctChange(50, 0)).toBeNull();
});

test("short rupees use Indian units", () => {
  expect(shortInr(950)).toBe("₹950");
  expect(shortInr(48000)).toBe("₹48 K");
  expect(shortInr(1240000)).toBe("₹12.4 L");
  expect(shortInr(24565610)).toBe("₹2.46 Cr");
  expect(shortInr(-150000)).toBe("-₹1.5 L");
  expect(shortInr(null)).toBe("₹0");
});

test("month pace projects from days gone, and compares like with like", () => {
  const p = monthPace([
    order({ net_total: 1500, created_at: new Date(2026, 10, 5).toISOString() }),
    order({ net_total: 1000, created_at: new Date(2026, 9, 10).toISOString() }),
    order({ net_total: 9000, created_at: new Date(2026, 9, 25).toISOString() }),
  ], NOW);
  expect(p.mtd).toBe(1500);
  expect(p.projected).toBeCloseTo(3103.45, 1); // 1500 in 14.5 days gone (noon on the 15th), of 30
  expect(p.lastMonthSameDays).toBe(1000);
  expect(p.lastMonthTotal).toBe(10000);
  expect(p.vsLastMonth).toBe(50);
});

test("channels rank by money, with their share and change", () => {
  const ch = (o) => o.ch;
  const m = channelMovers(
    [order({ ch: "Delhi", net_total: 750 }), order({ ch: "B2B", net_total: 250 })],
    [order({ ch: "Delhi", net_total: 500 })], ch
  );
  expect(m[0]).toMatchObject({ name: "Delhi", current: 750, share: 75, growth: 50, delta: 250 });
  expect(m[1]).toMatchObject({ name: "B2B", growth: null });
});

test("product board finds winners, risers and fallers", () => {
  const b = productBoard(
    [order({ net_total: 3000, items: [{ product_name: "A", price: 3000, quantity: 2 }] }), order({ net_total: 100, items: [{ product_name: "B", price: 100 }] })],
    [order({ net_total: 1000, items: [{ product_name: "A", price: 1000 }] }), order({ net_total: 800, items: [{ product_name: "C", price: 800 }] })],
    [{ name: "A", image_url: "a.jpg" }]
  );
  expect(b.top[0]).toMatchObject({ name: "A", qty: 2, image: "a.jpg" });
  expect(b.rising[0].name).toBe("A");
  expect(b.falling[0]).toMatchObject({ name: "C", delta: -800 });
  expect(b.bottom[0].name).toBe("B");
});

test("sizes add up to 100%", () => {
  const s = sizeBoard([order({ items: [{ size: "M", quantity: 3 }, { size: "L" }, { size: "" }] })]);
  expect(s).toEqual([{ name: "M", qty: 3, share: 75 }, { name: "L", qty: 1, share: 25 }]);
});

test("weekdays compare on an average day, not a total", () => {
  const monday = new Date(2026, 10, 9).toISOString();
  const nextMonday = new Date(2026, 10, 16).toISOString();
  const w = weekdayPattern([order({ net_total: 100, created_at: monday }), order({ net_total: 300, created_at: nextMonday })]);
  expect(w.find((d) => d.name === "Monday")).toMatchObject({ revenue: 400, average: 200, orders: 2 });
});

test("clients are new only when their first ever order is in the period", () => {
  const inNov = (ts) => new Date(ts).getMonth() === 10;
  const m = clientMix([
    order({ delivery_phone: "1", net_total: 300 }),
    order({ delivery_phone: "2", net_total: 700 }),
    order({ delivery_phone: "2", net_total: 500, created_at: new Date(2026, 1, 1).toISOString() }),
  ], inNov);
  expect(m).toMatchObject({ newRevenue: 300, returningRevenue: 700, newCount: 1, returningCount: 1, returningShare: 70 });
  // A second order inside the same long period still counts as returning.
  const y = clientMix([
    order({ delivery_phone: "3", net_total: 100, created_at: new Date(2026, 2, 1).toISOString() }),
    order({ delivery_phone: "3", net_total: 900, created_at: new Date(2026, 5, 1).toISOString() }),
  ], () => true);
  expect(y).toMatchObject({ newRevenue: 100, returningRevenue: 900, returningShare: 90 });
});

test("lapsed clients are big spenders who stopped ordering", () => {
  const old = new Date(2026, 0, 1).toISOString();
  const l = lapsedVips([
    order({ delivery_phone: "1", delivery_name: "Big", net_total: 5000, created_at: old }),
    order({ delivery_phone: "2", delivery_name: "Small", net_total: 100, created_at: old }),
    order({ delivery_phone: "3", delivery_name: "Recent", net_total: 9000 }),
    order({ delivery_phone: "4", delivery_name: "Partner", net_total: 9000, created_at: old, is_b2b: true }),
  ], NOW);
  expect(l.map((c) => c.name)).toEqual(["Big", "Small"]);
  expect(l[0].daysAway).toBeGreaterThan(300);
});

test("designs add up to the order, even when item prices already include an add-on", () => {
  const o = order({ net_total: 210000, items: [{ product_name: "Maliha", quantity: 1, price: 210000, additionals: [{ name: "Embroidery", price: 141500 }] }] });
  const board = productBoard([o], [], []);
  expect(board.rows[0].revenue).toBe(210000);
});

test("aftercare counts each kind, and ignores stock and alterations", () => {
  const a = aftercare([
    order({ refund_status: "pending" }),
    order({ return_reason: "fit" }),
    order({ exchange_reason: "size" }),
    order({ status: "cancelled" }),
    order({ status: "cancelled", is_stock_order: true }),
  ], always);
  expect(a.refunds.count).toBe(1);
  expect(a.returns.count).toBe(1);
  expect(a.exchanges.count).toBe(1);
  expect(a.cancellations).toEqual({ count: 1, value: 1000 });
});

test("attention puts the urgent first and stays quiet when all is well", () => {
  expect(buildAttention({})).toEqual([]);
  const a = buildAttention({
    b2bBalance: 1000, b2bPartnersOwing: 1,
    delayedCount: 5, delayedValue: 50000,
    pendingExhibitions: 1,
    outstanding: { old: { value: 100000, count: 2 } },
  });
  expect(a.map((i) => i.id)).toEqual(["exhibitions", "delayed", "outstanding", "b2b"]);
  expect(a[0].title).toBe("1 exhibition waiting for your approval");
});

test("attention ignores small swings", () => {
  expect(buildAttention({ discountRate: 4, previousDiscountRate: 1 })).toEqual([]);
  expect(buildAttention({ discountRate: 12, previousDiscountRate: 11 })).toEqual([]);
  expect(buildAttention({ discountRate: 12, previousDiscountRate: 8 })[0].id).toBe("discounts");
  expect(buildAttention({ qcFailRate: 40, qcFailCount: 2, qcInspected: 5 })).toEqual([]);
  expect(buildAttention({ cancellations: { count: 2, value: 9000 }, previousCancellations: { count: 1, value: 100 } })).toEqual([]);
});

test("highlights only say what there is data for", () => {
  expect(buildHighlights({})).toEqual([]);
  const h = buildHighlights({ topSa: { name: "Asha", revenue: 150000, orders: 1 } });
  expect(h[0]).toMatchObject({ text: "Top Sales Associate: Asha", sub: "₹1.5 L from 1 order" });
});

test("the headline reads like a sentence", () => {
  expect(headline({ revenue: 0, periodName: "This month" })).toBe("No sales recorded for this month yet.");
  expect(headline({
    revenue: 1200000, growth: 18.4, periodName: "This month", isThisMonth: true,
    topChannel: { name: "Shopify", share: 72 }, pace: { projected: 4000000 },
  })).toBe("Sales are up 18% on the period before, at ₹12 L. Shopify brought in 72% of it. At this pace the month closes near ₹40 L.");
  expect(headline({ revenue: 1000, growth: null, periodName: "All time" })).toBe("₹1 K in sales for all time.");
  expect(headline({ revenue: 1000, growth: 0.2, periodName: "Today" })).toContain("level");
});

test("a short period shows every day, so a quiet day reads as a dip", () => {
  const start = new Date(2026, 10, 1);
  const end = new Date(2026, 10, 3, 23);
  const rows = revenueSeries([order({ net_total: 500, created_at: new Date(2026, 10, 2, 10).toISOString() })], [], { start, end });
  expect(rows.map((r) => r.revenue)).toEqual([0, 500, 0]);
  expect(rows[1].label).toBe("2 Nov");
});

test("a long period groups by month", () => {
  const rows = revenueSeries([
    order({ net_total: 100, created_at: new Date(2026, 0, 5).toISOString() }),
    order({ net_total: 200, created_at: new Date(2026, 0, 9).toISOString() }),
    order({ net_total: 300, created_at: new Date(2026, 5, 9).toISOString() }),
  ], [], null);
  expect(rows.map((r) => [r.label, r.revenue])).toEqual([["Jan 26", 300], ["Jun 26", 300]]);
});

test("the brief counts sales only, and leaves out cancelled orders and stock", () => {
  const b = buildBrief({
    orders: [
      order({ net_total: 1000, discount_amount: 250 }),
      order({ net_total: 1000, status: "cancelled" }),
      order({ net_total: 0, is_stock_order: true }),
    ],
    products: [],
    inPeriod: always,
    previousRange: null,
    channelOf: () => "Delhi",
    now: NOW,
  });
  expect(b).toMatchObject({ revenue: 1000, count: 1, aov: 1000, revenueGrowth: null });
  expect(b.discount.rate).toBe(20);
  expect(b.movers).toHaveLength(1);
});
