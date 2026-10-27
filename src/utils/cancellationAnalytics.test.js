import {
  stageBucket, reasonKey, isSaleCancellation, buildCancellationRows, summariseCancellations,
} from "./cancellationAnalytics";

test("how far an order had got when cancelled", () => {
  expect(stageBucket(["order_received", "order_received"])).toBe("Before production");
  expect(stageBucket(["order_received", "stitching_in_progress"])).toBe("In production");
  expect(stageBucket(["production_complete", "order_received"])).toBe("Finished, not delivered");
  expect(stageBucket([])).toBe("No pieces");
  expect(stageBucket(["disposed"])).toBe("No pieces");
});

test("reasons group regardless of case, spacing and trailing dots", () => {
  expect(reasonKey("customer changed mind.")).toBe("Customer changed mind");
  expect(reasonKey("  Customer   changed mind ")).toBe("Customer changed mind");
  expect(reasonKey("Cancelled on Shopify")).toBe("Cancelled on Shopify");
  expect(reasonKey("Change_in_requirement")).toBe("Change in requirement");
  expect(reasonKey("")).toBe("No reason given");
});

test("only real sales count (stock moves and alterations are left out)", () => {
  expect(isSaleCancellation({ status: "cancelled" })).toBe(true);
  expect(isSaleCancellation({ status: "cancelled", is_stock_order: true })).toBe(false);
  expect(isSaleCancellation({ status: "cancelled", is_alteration: true })).toBe(false);
  expect(isSaleCancellation({ status: "revoked" })).toBe(false);
});

test("rows and summary: value, channel, reason, stage, who, trend, previous period", () => {
  const orders = [
    { id: "a", order_no: "SB-DLC-1026-000001", status: "cancelled", net_total: 20000, cancelled_at: "2026-10-05T10:00:00Z", cancellation_reason: "Customer changed mind", delivery_name: "Asha" },
    { id: "b", order_no: "SB-SHOPIFY-1026-000002", status: "cancelled", grand_total: 10000, cancelled_at: "2026-10-20T10:00:00Z", cancellation_reason: "Cancelled on Shopify", shopify_order_id: "1" },
    { id: "c", order_no: "SB-STOCK-1026-000003", status: "cancelled", is_stock_order: true, cancelled_at: "2026-10-06T10:00:00Z" },
  ];
  const comps = [{ order_id: "a", current_stage: "stitching_completed" }, { order_id: "b", current_stage: "order_received" }];
  const rows = buildCancellationRows(orders, comps, { a: "sa@sb.com" });
  expect(rows.map((r) => r.orderNo)).toEqual(["SB-SHOPIFY-1026-000002", "SB-DLC-1026-000001"]);
  expect(rows[1]).toMatchObject({ value: 20000, stage: "In production", cancelledBy: "sa@sb.com", customer: "Asha" });
  const s = summariseCancellations(rows, [rows[0]], "month");
  expect(s).toMatchObject({ count: 2, value: 30000, prevCount: 1, prevValue: 10000 });
  expect(s.byStage.map((x) => x.key)).toEqual(["Before production", "In production"]);
  expect(s.trend).toEqual([{ key: "2026-10", count: 2, value: 30000 }]);
  expect(s.byWho.find((x) => x.key === "Not recorded").count).toBe(1);
});
