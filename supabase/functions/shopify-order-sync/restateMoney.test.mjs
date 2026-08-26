// Self-check for the restate-money row filter.
//
// This mode rewrites AMOUNTS on real orders, so what it agrees to touch is the
// safety boundary. Its contract is narrow on purpose: move which column holds
// the pre- vs post-discount figure, and NEVER change what the customer paid.
//
// The prod dry run found 11 orders that violate that — two line items but a
// grand_total holding only one, total_quantity stuck at 1, ~₹1.9L under-recorded
// (e.g. #004591: stored ₹29,150 vs Shopify ₹58,050). Restating those would
// raise grand_total while leaving the count and items[] wrong: a
// half-correction that reads as fixed. They must be reported, not written.
//
// Mirrors the filter in index.ts (Deno-only, not importable) — same convention
// as remapMint.test.mjs and rawStale.test.mjs.
//
// Run: node supabase/functions/shopify-order-sync/restateMoney.test.mjs
import assert from "node:assert/strict";

// The decision, lifted from mode === "restate-money".
// Returns "skip" (nothing to do), "restate" (write it), or "mismatch" (report).
function classify({ prevGrand, prevNet, nextGrand, nextNet, totalPaid }) {
  if (nextGrand === prevGrand && nextNet === prevNet) return "skip";
  if (nextNet !== prevNet) return "mismatch";
  if (totalPaid != null && totalPaid > 0 && totalPaid !== nextNet) return "mismatch";
  return "restate";
}

// 1. THE discount bug — the only shape this mode writes. Stored grand_total
//    held the already-net figure; net stays put, grand rises by the discount.
//    Real values from #27567.
assert.equal(
  classify({ prevGrand: 240500, prevNet: 240500, nextGrand: 252500, nextNet: 240500, totalPaid: 240500 }),
  "restate",
);

// 2. Already correct → untouched. Makes the mode idempotent: running it twice
//    must be safe, which prod will do after a dry run.
assert.equal(
  classify({ prevGrand: 252500, prevNet: 240500, nextGrand: 252500, nextNet: 240500, totalPaid: 240500 }),
  "skip",
);

// 3. An UNDISCOUNTED order is untouched by construction — with discount 0 the
//    old and new arithmetic agree, so nothing to restate.
assert.equal(
  classify({ prevGrand: 19800, prevNet: 19800, nextGrand: 19800, nextNet: 19800, totalPaid: 19800 }),
  "skip",
);

// 4. THE GUARD. #004591: 2 line items, stored total holds one of them. net_total
//    would move, so this is a missing line item, not the discount split.
//    Reported, never written.
assert.equal(
  classify({ prevGrand: 29150, prevNet: 29150, nextGrand: 58050, nextNet: 58050, totalPaid: 0 }),
  "mismatch",
);

// 5. Same defect on an order that WAS partly paid (#005445). Still a mismatch —
//    the paid figure disagreeing does not make a half-correction acceptable.
assert.equal(
  classify({ prevGrand: 13770, prevNet: 13770, nextGrand: 29070, nextNet: 29070, totalPaid: 13770 }),
  "mismatch",
);

// 6. total_paid disagrees with the restated net — a partial refund or a manual
//    correction. Papering over that with a rewrite would hide a real problem.
assert.equal(
  classify({ prevGrand: 50000, prevNet: 50000, nextGrand: 55000, nextNet: 50000, totalPaid: 42000 }),
  "mismatch",
);

// 7. total_paid of 0 or null is not a disagreement — an unpaid COD order is
//    ordinary, and must still get its discount split fixed.
assert.equal(
  classify({ prevGrand: 15550, prevNet: 15550, nextGrand: 16400, nextNet: 15550, totalPaid: 0 }),
  "restate",
);
assert.equal(
  classify({ prevGrand: 15550, prevNet: 15550, nextGrand: 16400, nextNet: 15550, totalPaid: null }),
  "restate",
);

// 8. The invariant every written row satisfies: the invoice ends up printing
//    exactly what was paid. Verified against real prod dry-run figures.
for (const [grand, net, disc] of [
  [252500, 240500, 12000],
  [47500, 42750, 4750],
  [14850, 14107.5, 742.5],   // paise must not drift
  [132500, 106000, 26500],
]) {
  assert.equal(classify({ prevGrand: net, prevNet: net, nextGrand: grand, nextNet: net, totalPaid: net }), "restate");
  assert.ok(Math.abs(grand - disc - net) < 0.01, `invoice must print ${net}, not ${grand - disc}`);
}

console.log("restateMoney.test.mjs — all assertions passed");
