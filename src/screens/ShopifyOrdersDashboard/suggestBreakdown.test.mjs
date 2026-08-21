// Self-check for suggestBreakdown — the name-based PRE-SELECTION for typed
// (draft-order) line items.
//
// The suggestion never mints anything on its own; a person confirms it. But a
// bad suggestion is a bad default that someone will click through, so the
// traps are worth pinning: a name mentioning a dupatta ALONGSIDE a garment is a
// SET, not an accessory — the case naive "contains dupatta" matching gets
// wrong. The first three cases are the real live order names.
//
// Run:
//   node src/screens/ShopifyOrdersDashboard/suggestBreakdown.test.mjs
// (extract BREAKDOWN_SUGGESTIONS + suggestBreakdown into ./suggest.mjs first —
//  they live in the dashboard file, which imports React and cannot run in node)
import assert from "node:assert/strict";
import { suggestBreakdown } from "./suggest.mjs";
const cases = [
  // The three REAL names from the live orders.
  ["LIghter Dupatta", "dupatta_only"],
  ["mohsina orange - only dupatta", "dupatta_only"],
  ["Mohsina - Orange Short Kalidaar Choga With Salwar - Top XL and Bottom M - without dupatta", "top_bottom"],
  // Sets must NOT read as accessories.
  ["Mohsina orange dupatta set", "top_bottom_dupatta"],
  ["Kurta with dupatta", "top_bottom_dupatta"],
  ["Anarkali suit with chunni", "top_bottom_dupatta"],
  // Accessories alone.
  ["Odhni pc", "dupatta_only"],
  ["Silk scarf", "dupatta_only"],
  // Two-piece, no dupatta mentioned.
  ["Choga with salwar", "top_bottom"],
  ["Kurta and palazzo", "top_bottom"],
  // Word-boundary traps: must NOT match garment words inside other words.
  ["Sunset dupatta", "dupatta_only"],
  // Nothing useful → no suggestion, person picks unaided.
  ["Custom piece", null],
  ["", null],
  [null, null],
];
let bad = 0;
for (const [name, want] of cases) {
  const got = suggestBreakdown(name);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${JSON.stringify(name)} -> ${got} (want ${want})`);
}
assert.equal(bad, 0, `${bad} suggestion(s) wrong`);
console.log("\nall suggestion checks passed");
