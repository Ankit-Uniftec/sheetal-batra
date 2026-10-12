import { dispatchSummary } from "./shipmentStatus";

const box = (status, at, n, extra = {}) => ({
  status, dispatched_at: at, shipment_components: Array.from({ length: n }, (_, i) => ({ component_id: `c${i}` })), ...extra,
});

test("nothing shipped (or only cancelled boxes) → null", () => {
  expect(dispatchSummary([])).toBeNull();
  expect(dispatchSummary([box("cancelled", "2026-10-01", 2)])).toBeNull();
});

test("latest box wins for date/courier; pieces add up; partial when short", () => {
  const s = dispatchSummary([
    box("dispatched", "2026-10-01T10:00:00Z", 1, { courier_name: "Blitz" }),
    box("dispatched", "2026-10-05T10:00:00Z", 1, { courier_name: "BlueDart", awb: "123" }),
  ], 3);
  expect(s).toEqual({ delivered: false, partial: true, pieces: 2, at: "2026-10-05T10:00:00Z", courier: "BlueDart", awb: "123" });
});

test("delivered only when every live box is delivered; unknown total is never partial", () => {
  expect(dispatchSummary([box("delivered", "x", 2)]).delivered).toBe(true);
  expect(dispatchSummary([box("delivered", "x", 1), box("dispatched", "y", 1)]).delivered).toBe(false);
  expect(dispatchSummary([box("dispatched", "x", 1)]).partial).toBe(false);
});
