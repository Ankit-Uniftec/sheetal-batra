// Guards the Retail Manager analytics rules that were reported wrong:
// revenue must be net of exhibition commission, cancelled/returned orders must
// never count as sales, and day buckets must not merge across years.
import { isRevenueOrder } from "../../utils/revenue";
import { totalNetSbRevenue } from "../../utils/exhibitionService";
import { getOrderChannelLabel } from "../../utils/barcodeService";

// Mirrors the helpers in RetailManagerDashboard.jsx.
const two = (n) => String(n).padStart(2, "0");
const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};

test("a cancelled order contributes no revenue and is not a sale", () => {
  const cancelled = { status: "cancelled", net_total: 50000 };
  expect(isRevenueOrder(cancelled)).toBe(false);
  // The day-wise tab summed these unguarded, so its totals ran ahead of the
  // Store Analytics tab for the same period.
  const counted = [cancelled].filter(isRevenueOrder);
  expect(totalNetSbRevenue(counted)).toBe(0);
});

test("a refunded order is excluded even when its status looks healthy", () => {
  expect(isRevenueOrder({ status: "delivered", refund_status: "processed" })).toBe(false);
});

test("exhibition revenue is net of the partner's commission", () => {
  // 20% commission on 100000 -> SB earned 80000, not the full gross.
  const order = { exhibition_id: "e1", net_total: 100000, net_sb_revenue: 80000 };
  expect(totalNetSbRevenue([order])).toBe(80000);
  // A non-exhibition order still contributes its full value.
  expect(totalNetSbRevenue([{ net_total: 100000 }])).toBe(100000);
});

test("a stock order raised through a store is not that store's revenue", () => {
  // The exact trap: SB-LDHC- prefix AND a Ludhiana salesperson_store, so the
  // old salesperson_store matching booked it as Ludhiana store sales.
  const stock = {
    order_no: "SB-LDHC-0726-000001",
    is_stock_order: true,
    salesperson_store: "Ludhiana Store",
  };
  expect(getOrderChannelLabel(stock)).toBe("Retail Stock");
  expect(getOrderChannelLabel(stock)).not.toBe("Ludhiana Store");
});

test("real store orders still resolve to their store", () => {
  expect(getOrderChannelLabel({ order_no: "SB-DLC-0726-003625" })).toBe("Delhi Store");
  expect(getOrderChannelLabel({ order_no: "SB-LDHC-0726-000042" })).toBe("Ludhiana Store");
});

test("day buckets keep the year, so the same date in two years stays apart", () => {
  expect(dayKey("2025-01-14T10:00:00")).toBe("2025-01-14");
  expect(dayKey("2026-01-14T10:00:00")).toBe("2026-01-14");
  expect(dayKey("2025-01-14T10:00:00")).not.toBe(dayKey("2026-01-14T10:00:00"));
});

test("a late-evening order buckets on its local day, not the UTC one", () => {
  // 23:30 IST on the 14th is 18:00Z the same day, but toISOString() on a date
  // built from local parts was shifting late orders off by one.
  const local = new Date(2026, 0, 14, 23, 30);
  expect(dayKey(local)).toBe("2026-01-14");
});
