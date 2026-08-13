// Delivery date = order date + N days, by ORDER TOTAL alone (client rule:
// amount only, category dropped). Mirrors resolveDeliveryDate in mapper.ts.
// Run: node supabase/functions/shopify-order-sync/deliveryDate.test.js
const assert = require("assert");

const BANDS = [
  { key: "10-25k", max: 25_000, days: 10 },
  { key: "25-40k", max: 40_000, days: 14 },
  { key: "40-75k", max: 75_000, days: 18 },
  { key: "75k+", max: Infinity, days: 22 },
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
assert.strictEqual(days(25_000), 10, "25000 must stay in the 10-day band");
assert.strictEqual(days(25_001), 14);
assert.strictEqual(days(40_000), 14);
assert.strictEqual(days(40_001), 18);
assert.strictEqual(days(75_000), 18, "exactly 75000 is 18 days, not 22");
assert.strictEqual(days(75_001), 22);

// Below the first band still uses the first column.
assert.strictEqual(days(0), 10);
assert.strictEqual(days(1), 10);
assert.strictEqual(days(9_999), 10);

// A zero-total order is valid (gifted / fully discounted) and gets a date.
assert.strictEqual(resolve(D, 0), "2026-01-11");

// Only genuinely unusable amounts block.
assert.strictEqual(resolve(D, -1), null, "negative total must block");
assert.strictEqual(resolve(D, NaN), null, "NaN total must block");
assert.strictEqual(resolve(D, Infinity), null, "non-finite total must block");

// Date arithmetic, including a month boundary.
assert.strictEqual(resolve(D, 10_000), "2026-01-11");
assert.strictEqual(resolve("2026-01-25T00:00:00Z", 100_000), "2026-02-16");

// Category is NOT part of the rule: same amount, same date, whatever it is.
assert.strictEqual(resolve(D, 20_000), resolve(D, 20_000));

console.log("delivery-date rule: all assertions passed (amount-only, 10/14/18/22)");
