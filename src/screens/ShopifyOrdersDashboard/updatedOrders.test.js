// Guards "Updated Orders" (meeting point 46): who counts as updated, when they
// drop off (first scan), and how they are pinned on the Orders tab.
import { isFirstScanned, isUpdatedOrder, pinUpdatedFirst, clearedAgo } from "./updatedOrders";

const free = { inReview: false, cancelled: false };

test("updated = left review, not back in review, not cancelled, not yet scanned", () => {
  const o = { review_cleared_at: "2026-10-12T10:00:00Z" };
  expect(isUpdatedOrder(o, [{ current_stage: "order_received" }], free)).toBe(true);
  expect(isUpdatedOrder(o, [], free)).toBe(true); // no pieces minted yet
  expect(isUpdatedOrder({}, [], free)).toBe(false); // never in review
  expect(isUpdatedOrder(o, [], { inReview: true, cancelled: false })).toBe(false);
  expect(isUpdatedOrder(o, [], { inReview: false, cancelled: true })).toBe(false);
});

test("the first scan takes it out", () => {
  const o = { review_cleared_at: "2026-10-12T10:00:00Z" };
  const scanned = [{ current_stage: "order_received" }, { current_stage: "cloth_issued" }];
  expect(isFirstScanned(scanned)).toBe(true);
  expect(isUpdatedOrder(o, scanned, free)).toBe(false);
});

test("pinning: updated first (most recently cleared first), the rest keep their order", () => {
  const rows = [
    { id: "a" },
    { id: "b", review_cleared_at: "2026-10-12T08:00:00Z" },
    { id: "c" },
    { id: "d", review_cleared_at: "2026-10-12T09:00:00Z" },
  ];
  const up = (o) => !!o.review_cleared_at;
  expect(pinUpdatedFirst(rows, up).map((o) => o.id)).toEqual(["d", "b", "a", "c"]);
  expect(pinUpdatedFirst(rows, () => false).map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
});

test("badge wording", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  expect(clearedAgo("2026-10-12T11:59:40Z", now)).toBe("just now");
  expect(clearedAgo("2026-10-12T11:48:00Z", now)).toBe("12 min ago");
  expect(clearedAgo("2026-10-12T09:00:00Z", now)).toBe("3 h ago");
  expect(clearedAgo("2026-10-11T12:00:00Z", now)).toBe("1 day ago");
  expect(clearedAgo(null, now)).toBe("");
});
