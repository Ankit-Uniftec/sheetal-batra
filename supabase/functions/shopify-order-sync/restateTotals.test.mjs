// Self-check for the restate-totals safety rules.
//
// This mode raises AMOUNTS on real orders, so what it refuses matters more than
// what it writes. Two rules, both load-bearing:
//
//   1. NAMED ORDERS ONLY — no sweep-everything form exists.
//   2. NOTHING COLLECTED — total_paid + advance_payment + every order_payments
//      row must be zero. Raising the total on an order where money changed
//      hands would make a settled order look underpaid and could trigger a
//      wrongful collection call to a customer who already paid.
//
// Rule 2 is what keeps the 9 PREPAID orders (Shopify PAID, our total_paid
// holding the old wrong figure) out of this mode until a human has checked the
// gateway record. It must refuse them even though their data looks identical to
// the COD rows in every other respect.
//
// Mirrors the logic in index.ts (Deno-only, not importable) — same convention
// as remapMint.test.mjs, rawStale.test.mjs and restateMoney.test.mjs.
//
// Run: node supabase/functions/shopify-order-sync/restateTotals.test.mjs
import assert from "node:assert/strict";

// Rule 2, lifted from mode === "restate-totals".
const collectedOn = (o, payments = []) =>
  (Number(o.total_paid) || 0) +
  (Number(o.advance_payment) || 0) +
  payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

const wouldWrite = (o, next, payments = []) => {
  if (collectedOn(o, payments) > 0) return "refused";
  if (Math.abs(next.grand_total - next.discount_amount - next.net_total) > 0.01) return "refused";
  if (next.grand_total === o.grand_total && next.net_total === o.net_total) return "skip";
  return "write";
};

// Real prod values.
const cod4591 = { total_paid: 0, advance_payment: 0, grand_total: 29150, net_total: 29150 };
const next4591 = { grand_total: 58050, net_total: 58050, discount_amount: 0 };

// 1. THE case this mode is for. COD #27157: nothing collected, stored total
//    holds one of two line items. Writes.
assert.equal(wouldWrite(cod4591, next4591), "write");

// 2. All nine COD orders qualify — nothing collected on any of them.
for (const [stored, shopify] of [
  [29150, 58050], [15550, 30850], [8750, 17250], [20500, 40750], [15100, 29950],
  [12400, 24550], [44425, 44675], [20650, 41050], [21310, 44710],
]) {
  assert.equal(
    wouldWrite(
      { total_paid: 0, advance_payment: 0, grand_total: stored, net_total: stored },
      { grand_total: shopify, net_total: shopify, discount_amount: 0 },
    ),
    "write",
  );
}

// 3. RULE 2. A PREPAID order is refused, even though everything else about it
//    matches a COD row. #27065: Shopify says PAID and total_paid holds the old
//    wrong ₹17,500 — exactly the shape that must NOT be auto-corrected.
assert.equal(
  wouldWrite(
    { total_paid: 17500, advance_payment: 0, grand_total: 17500, net_total: 17500 },
    { grand_total: 35000, net_total: 35000, discount_amount: 0 },
  ),
  "refused",
);

// 4. A part-payment counts as collected. #27559 is PARTIALLY_PAID.
assert.equal(
  wouldWrite(
    { total_paid: 13770, advance_payment: 0, grand_total: 13770, net_total: 13770 },
    { grand_total: 29070, net_total: 29070, discount_amount: 0 },
  ),
  "refused",
);

// 5. An advance with total_paid still 0 also counts — both columns are checked,
//    not just one.
assert.equal(
  wouldWrite(
    { total_paid: 0, advance_payment: 5000, grand_total: 29150, net_total: 29150 },
    next4591,
  ),
  "refused",
);

// 6. An order_payments row disqualifies even when BOTH columns read zero. The
//    columns can lag; the payments table is the record of money received.
assert.equal(wouldWrite(cod4591, next4591, [{ amount: 1000 }]), "refused");

// 7. Already correct → skipped, so the mode is idempotent.
assert.equal(
  wouldWrite(
    { total_paid: 0, advance_payment: 0, grand_total: 58050, net_total: 58050 },
    next4591,
  ),
  "skip",
);

// 8. A mapper result that does not balance is refused rather than written —
//    never store a total whose own arithmetic disagrees.
assert.equal(
  wouldWrite(cod4591, { grand_total: 58050, net_total: 50000, discount_amount: 0 }),
  "refused",
);

// 9. A discounted COD order still balances: grand - discount = net.
assert.equal(
  wouldWrite(
    { total_paid: 0, advance_payment: 0, grand_total: 15550, net_total: 15550 },
    { grand_total: 32850, net_total: 30850, discount_amount: 2000 },
  ),
  "write",
);

// 10. RULE 1. An empty or missing orderNos list is an error, never a sweep.
const requiresNames = (body) =>
  Array.isArray(body?.orderNos) && body.orderNos.map(String).filter(Boolean).length > 0;
assert.equal(requiresNames({ orderNos: ["SB-SHOPIFY-0826-004591"] }), true);
assert.equal(requiresNames({ orderNos: [] }), false);
assert.equal(requiresNames({}), false);
assert.equal(requiresNames({ orderNos: "SB-SHOPIFY-0826-004591" }), false);

console.log("restateTotals.test.mjs — all assertions passed");
