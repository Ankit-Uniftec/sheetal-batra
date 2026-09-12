// Guards repeat-vendor detection: a component sent BACK to a vendor it has
// already visited is rework, and must be flagged (and carry a reason) while the
// first trip to that vendor must not be.
import { markRepeats, repeatVendorCounts, filterExternalMovements } from "./externalMovements";

// Newest-first, the order fetchAllMovements returns (and its callers rely on).
const rows = [
  { id: "m3", component_id: "c1", vendor_id: "v1", vendor_name: "Shah", created_at: "2026-03-01" },
  { id: "m2", component_id: "c1", vendor_id: "v2", vendor_name: "Rana", created_at: "2026-02-01" },
  { id: "m1", component_id: "c1", vendor_id: "v1", vendor_name: "Shah", created_at: "2026-01-01" },
  { id: "m4", component_id: "c2", vendor_id: "v1", vendor_name: "Shah", created_at: "2026-04-01" },
];

test("only the second trip to the same vendor is a repeat", () => {
  const byId = Object.fromEntries(markRepeats(rows).map((r) => [r.id, r.isRepeat]));
  expect(byId.m1).toBe(false); // first trip to Shah
  expect(byId.m2).toBe(false); // different vendor
  expect(byId.m3).toBe(true);  // back to Shah
  expect(byId.m4).toBe(false); // different component, first trip
});

test("the caller's newest-first order is preserved", () => {
  expect(markRepeats(rows).map((r) => r.id)).toEqual(["m3", "m2", "m1", "m4"]);
});

test("a stored reason marks a repeat even when the earlier trip is out of scope", () => {
  const [only] = markRepeats([
    { id: "x", component_id: "c9", vendor_id: "v9", created_at: "2026-05-01", repeat_reason: "thread mismatch" },
  ]);
  expect(only.isRepeat).toBe(true);
});

test("rework leaderboard counts repeats per vendor, busiest first", () => {
  const marked = markRepeats([
    ...rows,
    { id: "m5", component_id: "c2", vendor_id: "v1", vendor_name: "Shah", created_at: "2026-05-01" },
    { id: "m6", component_id: "c1", vendor_id: "v2", vendor_name: "Rana", created_at: "2026-06-01" },
  ]);
  expect(repeatVendorCounts(marked)).toEqual([{ vendor: "Shah", count: 2 }, { vendor: "Rana", count: 1 }]);
});

test("repeatOnly keeps just the re-sends", () => {
  const out = filterExternalMovements(markRepeats(rows), { repeatOnly: true });
  expect(out.map((r) => r.id)).toEqual(["m3"]);
});
