// Guards the four dispatch-desk figures: T-2 production adherence, on-time
// delivery, and delivery fails. These are the numbers people are judged on, so
// the edge cases below are the ones that would quietly skew a scorecard.
import { computeDeliveryPerformance, productionFinishedAtByOrder } from "./productionMetrics";

const at = (s) => new Date(s).toISOString();

describe("productionFinishedAtByOrder", () => {
  test("takes the LAST piece to finish, not the first", () => {
    const map = productionFinishedAtByOrder([
      { order_id: "o1", current_stage: "final_qc_passed", stage_updated_at: at("2026-03-01") },
      { order_id: "o1", current_stage: "dispatched", stage_updated_at: at("2026-03-05") },
    ]);
    expect(new Date(map.o1).toISOString().slice(0, 10)).toBe("2026-03-05");
  });

  test("ignores pieces still in production", () => {
    const map = productionFinishedAtByOrder([
      { order_id: "o1", current_stage: "stitching_in_progress", stage_updated_at: at("2026-03-01") },
    ]);
    expect(map.o1).toBeUndefined();
  });
});

describe("T-2 production adherence", () => {
  // delivery 20th, placed 1st -> T-2 deadline is the 18th.
  const order = { id: "o1", delivery_date: "2026-03-20", created_at: at("2026-03-01") };

  test("finishing ON the T-2 date counts as on time", () => {
    const r = computeDeliveryPerformance([order], [], { o1: new Date("2026-03-18T18:00:00").getTime() });
    expect(r.production).toMatchObject({ onTime: 1, late: 0, rate: 100 });
  });

  test("finishing after T-2 is late even if before the customer date", () => {
    const r = computeDeliveryPerformance([order], [], { o1: new Date("2026-03-19T09:00:00").getTime() });
    expect(r.production).toMatchObject({ onTime: 0, late: 1, rate: 0 });
    expect(r.production.orders).toHaveLength(1);
  });

  test("an unfinished order is not scored at all", () => {
    const r = computeDeliveryPerformance([order], [], {});
    expect(r.production).toMatchObject({ scored: 0, rate: null });
  });

  test("a rush order (<2 days) is measured against the real delivery date", () => {
    // Placed the 19th for the 20th: no room to subtract, so T-2 does not apply.
    const rush = { id: "r1", delivery_date: "2026-03-20", created_at: at("2026-03-19") };
    const r = computeDeliveryPerformance([rush], [], { r1: new Date("2026-03-20T10:00:00").getTime() });
    expect(r.production).toMatchObject({ onTime: 1, late: 0 });
  });
});

describe("on-time delivery", () => {
  test("delivered later in the day it was promised is ON time", () => {
    // The bug this guards: a DATE vs TIMESTAMPTZ compare made an 18:00 delivery
    // on the promised day look late against that day's 00:00.
    const r = computeDeliveryPerformance(
      [{ id: "o1", delivery_date: "2026-03-20", delivered_at: at("2026-03-20T18:30:00") }], []
    );
    expect(r.delivery).toMatchObject({ onTime: 1, late: 0, rate: 100 });
  });

  test("delivered the next day is late", () => {
    const r = computeDeliveryPerformance(
      [{ id: "o1", delivery_date: "2026-03-20", delivered_at: at("2026-03-21T09:00:00") }], []
    );
    expect(r.delivery).toMatchObject({ onTime: 0, late: 1, rate: 0 });
  });

  test("an undelivered order is not counted as late", () => {
    const r = computeDeliveryPerformance([{ id: "o1", delivery_date: "2026-03-20" }], []);
    expect(r.delivery).toMatchObject({ scored: 0, rate: null });
  });
});

describe("delivery fails", () => {
  test("counts failed and returned shipments only", () => {
    const r = computeDeliveryPerformance([], [
      { id: "s1", status: "delivered" }, { id: "s2", status: "failed" },
      { id: "s3", status: "returned" }, { id: "s4", status: "dispatched" },
      { id: "s5", status: "cancelled" },   // cancelled never shipped — not a fail
    ]);
    expect(r.fails.count).toBe(2);
  });
});

test("empty input yields null rates, never a fabricated 0%", () => {
  const r = computeDeliveryPerformance([], []);
  expect(r.production.rate).toBeNull();
  expect(r.delivery.rate).toBeNull();
  expect(r.fails.count).toBe(0);
});
