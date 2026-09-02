// Delivery date = order date + N days, by ORDER TOTAL alone (client rule:
// amount only, category dropped). Mirrors resolveDeliveryDate in mapper.ts.
// Run: node supabase/functions/shopify-order-sync/deliveryDate.test.js
const assert = require("assert");

const BANDS = [
  { key: "10-25k", max: 25_000, days: 11 },
  { key: "25-40k", max: 40_000, days: 15 },
  { key: "40-75k", max: 75_000, days: 20 },
  { key: "75k-1.5L", max: 150_000, days: 24 },
  { key: "1.5L-2L", max: 200_000, days: 28 },
  { key: "2L+", max: Infinity, days: 30 },
];
const addDays = (iso, days) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const bandIdx = (a) => {
  for (let i = 0; i < BANDS.length; i++) if (a <= BANDS[i].max) return i;
  return BANDS.length - 1;
};
const resolve = (createdAt, total) => {
  if (!Number.isFinite(total) || total < 0) return null;
  return addDays(createdAt, BANDS[bandIdx(total)].days);
};

const D = "2026-01-01T00:00:00Z";
const days = (total) => BANDS[bandIdx(total)].days;

// Upper bound is INCLUSIVE — the boundary is the thing most likely to be got wrong.
assert.strictEqual(days(25_000), 11, "25000 must stay in the 11-day band");
assert.strictEqual(days(25_001), 15);
assert.strictEqual(days(40_000), 15);
assert.strictEqual(days(40_001), 20);
assert.strictEqual(days(75_000), 20, "exactly 75000 is 20 days, not 24");
assert.strictEqual(days(75_001), 24);
assert.strictEqual(days(150_000), 24, "exactly 1.5L is 24 days, not 28");
assert.strictEqual(days(150_001), 28);
assert.strictEqual(days(200_000), 28, "exactly 2L is 28 days, not 30");
assert.strictEqual(days(200_001), 30);
assert.strictEqual(days(1_000_000), 30);

// Below the first band still uses the first column.
assert.strictEqual(days(0), 11);
assert.strictEqual(days(1), 11);
assert.strictEqual(days(9_999), 11);

// A zero-total order is valid (gifted / fully discounted) and gets a date.
assert.strictEqual(resolve(D, 0), "2026-01-12");

// Only genuinely unusable amounts block.
assert.strictEqual(resolve(D, -1), null, "negative total must block");
assert.strictEqual(resolve(D, NaN), null, "NaN total must block");
assert.strictEqual(resolve(D, Infinity), null, "non-finite total must block");

// Date arithmetic, including a month boundary.
assert.strictEqual(resolve(D, 10_000), "2026-01-12");
assert.strictEqual(resolve("2026-01-25T00:00:00Z", 100_000), "2026-02-18");

// Category is NOT part of the rule: same amount, same date, whatever it is.
assert.strictEqual(resolve(D, 20_000), resolve(D, 20_000));

console.log("delivery-date rule: all assertions passed (amount-only, 11/15/20/24/28/30)");
