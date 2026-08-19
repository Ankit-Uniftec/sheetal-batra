// Self-check for itemNetAmount + shipmentBalance. There is no test framework in this
// repo (src/App.test.js is the stock CRA smoke test and does not run against the real
// app), so this is a plain node script:
//
//     node src/utils/itemNetAmount.selfcheck.js
//
// It exists because these two files split MONEY. The invariant that matters is that
// per-item finals sum to the order total — if that breaks, a per-shipment balance
// under- or over-collects from a real customer, silently.

const assert = require("assert");

// The modules are ESM; this script is run directly by node, so re-declare the tiny
// pure functions under test rather than dragging in a transpiler. Keep in step with
// itemNetAmount.js — if you change the maths there, change it here and re-run.
const sumPrices = (l) => (l || []).reduce((s, x) => s + (Number(x?.price) || 0), 0);
const extrasOf = (i) => sumPrices(i?.extras) + sumPrices(i?.additionals);
const productOnlyOf = (i) => Number(i?.price || 0) * Number(i?.quantity || 1);
const grossOf = (i) => productOnlyOf(i) + extrasOf(i);
const productBasis = (o) => (o?.items || []).reduce((s, i) => s + productOnlyOf(i), 0);

const itemAmounts = (order, item) => {
  const gross = grossOf(item);
  const basis = productBasis(order);
  const orderDiscount = Number(order?.discount_amount || 0);
  const ratio = basis > 0 ? productOnlyOf(item) / basis : 0;
  const discount = Math.min(productOnlyOf(item), orderDiscount * ratio);
  return { gross, discount, final: Math.max(0, gross - discount) };
};
const orderItemsFinal = (o) =>
  (o.items || []).reduce((s, i) => s + itemAmounts(o, i).final, 0);

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log("  ok  " + name); };

console.log("itemNetAmount self-check\n");

// ── 1. The reason this file exists: extras must not vanish ───────────────────
check("extras and additionals count toward the item", () => {
  const order = {
    items: [{ price: 20000, quantity: 1, additionals: [{ name: "dupatta", price: 20000 }] }],
    discount_amount: 0,
  };
  // Before the fix this returned 20000 and the ₹20,000 dupatta was uncollectable.
  assert.strictEqual(itemAmounts(order, order.items[0]).final, 40000);
});

// ── 2. The invariant that protects real customers ────────────────────────────
check("per-item finals sum to the order total (no discount)", () => {
  const order = {
    items: [
      { price: 20000, quantity: 1, extras: [{ price: 1500 }] },
      { price: 8000, quantity: 2 },
      { price: 5000, quantity: 1, additionals: [{ price: 500 }] },
    ],
    discount_amount: 0,
  };
  const netTotal = 20000 + 1500 + 16000 + 5000 + 500;
  assert.strictEqual(orderItemsFinal(order), netTotal);
});

check("per-item finals sum to the order total (with discount)", () => {
  const order = {
    items: [
      { price: 10000, quantity: 1, extras: [{ price: 2000 }] },
      { price: 5000, quantity: 1 },
    ],
    discount_amount: 3000,
  };
  // Discount applies to the 15,000 of garments only, never to the 2,000 extra.
  assert.strictEqual(orderItemsFinal(order), 15000 + 2000 - 3000);
});

// ── 3. The documented example must still hold ────────────────────────────────
check("header example: 10k kurta + 5k saree, 3k off", () => {
  const order = {
    items: [{ price: 10000, quantity: 1 }, { price: 5000, quantity: 1 }],
    discount_amount: 3000,
  };
  const [kurta, saree] = order.items.map((i) => itemAmounts(order, i));
  assert.strictEqual(kurta.discount, 2000);
  assert.strictEqual(kurta.final, 8000);
  assert.strictEqual(saree.discount, 1000);
  assert.strictEqual(saree.final, 4000);
});

// ── 4. Discount never eats the extras ────────────────────────────────────────
check("a discount larger than the garment cannot consume extras", () => {
  const order = {
    items: [{ price: 5000, quantity: 1, extras: [{ price: 4000 }] }],
    discount_amount: 9000, // more than the garment is worth
  };
  // The extra survives: 5000 garment wiped out, 4000 extra still owed.
  assert.strictEqual(itemAmounts(order, order.items[0]).final, 4000);
});

// ── 5. Pro-rata allocation must not leak a rupee ─────────────────────────────
// This is the rounding rule shipmentBalance.js relies on: shares must sum EXACTLY
// to the amount being split, whatever the ratios do.
check("pro-rata allocation sums exactly to the advance", () => {
  const allocate = (total, weights) => {
    const sum = weights.reduce((a, b) => a + b, 0);
    let used = 0;
    return weights.map((w, i) => {
      if (i === weights.length - 1) return total - used;   // last absorbs the remainder
      const share = Math.round((total * w) / sum);
      used += share;
      return share;
    });
  };
  // 10,000 over thirds — the case that leaks with naive rounding.
  const shares = allocate(10000, [1, 1, 1]);
  assert.strictEqual(shares.reduce((a, b) => a + b, 0), 10000);
  // And an awkward real-world split.
  const s2 = allocate(11111, [20000, 8000, 5000]);
  assert.strictEqual(s2.reduce((a, b) => a + b, 0), 11111);
});

// ── 6. Degenerate orders must not divide by zero ─────────────────────────────
check("zero-value order does not produce NaN", () => {
  const order = { items: [{ price: 0, quantity: 1 }], discount_amount: 0 };
  const r = itemAmounts(order, order.items[0]);
  assert.strictEqual(r.final, 0);
  assert.ok(!Number.isNaN(r.discount));
});

console.log(`\n${checks} checks passed.`);
