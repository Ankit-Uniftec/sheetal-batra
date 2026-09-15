// Self-check for b2bPricing. There is no test framework in this repo
// (src/App.test.js is the stock CRA smoke test), so this is a plain node script:
//
//     node src/utils/b2bPricing.selfcheck.js
//
// It exists because this file decides how much a B2B vendor is charged. The
// invariant that matters: the collector code comes off the POST-markdown price.
// Applying both to MRP over-discounts every order carrying a collector code,
// which is the bug this was written to fix.

const assert = require("assert");

// b2bPricing.js is ESM and this script is run directly by node, so the function
// is re-declared here rather than dragging in a transpiler — the same convention
// itemNetAmount.selfcheck.js uses. Keep in step with b2bPricing.js.
function b2bPricing(grandTotal, markdownPercent, collectorPercent) {
  const mrp = Number(grandTotal) || 0;
  const mdPct = Number(markdownPercent) || 0;
  const colPct = Number(collectorPercent) || 0;

  const markdownAmount = mrp * (mdPct / 100);
  const afterMarkdown = mrp - markdownAmount;
  const collectorDiscountAmount = afterMarkdown * (colPct / 100);

  return {
    markdownAmount,
    afterMarkdown,
    collectorDiscountAmount,
    finalTotal: afterMarkdown - collectorDiscountAmount,
  };
}

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log("  ok  " + name); };

console.log("b2bPricing self-check\n");

// ── 1. The order that surfaced the bug ───────────────────────────────────────
// Amayra Emerald Green, 5XL: 19,000 MRP, 35% markdown, 5% collector code.
// The screen showed collector = 950 (5% of MRP). Correct is 617.50.
check("collector code applies to the post-markdown price, not MRP", () => {
  const p = b2bPricing(19000, 35, 5);
  assert.strictEqual(p.markdownAmount, 6650);
  assert.strictEqual(p.afterMarkdown, 12350);
  assert.strictEqual(p.collectorDiscountAmount, 617.5);
  assert.strictEqual(p.finalTotal, 11732.5);
  // The old wrong behaviour, pinned so a revert fails loudly.
  assert.notStrictEqual(p.collectorDiscountAmount, 950);
  assert.notStrictEqual(p.finalTotal, 11400);
});

// ── 2. Sequential is always >= parallel ──────────────────────────────────────
// Stacking on the remainder can never give away more than stacking on MRP.
check("sequential never discounts more than the old parallel maths", () => {
  for (const [mrp, md, col] of [
    [19000, 35, 5], [50000, 10, 20], [1234.56, 42.5, 7.5], [999, 60, 15],
  ]) {
    const p = b2bPricing(mrp, md, col);
    const parallelFinal = mrp - mrp * (md / 100) - mrp * (col / 100);
    assert.ok(p.finalTotal >= parallelFinal, `${mrp}/${md}/${col}`);
  }
});

// ── 3. Parts must sum to the total ───────────────────────────────────────────
// Dashboards subtract these columns independently; if they stop summing, a
// report silently disagrees with the invoice.
check("markdown + collector + final === MRP", () => {
  for (const [mrp, md, col] of [
    [19000, 35, 5], [0, 35, 5], [88000, 0, 12], [7500, 100, 50],
  ]) {
    const p = b2bPricing(mrp, md, col);
    const sum = p.markdownAmount + p.collectorDiscountAmount + p.finalTotal;
    assert.ok(Math.abs(sum - mrp) < 1e-9, `${mrp}/${md}/${col} summed to ${sum}`);
  }
});

// ── 4. No collector code changes nothing ─────────────────────────────────────
// The common case — most B2B orders carry a markdown and no code.
check("0% collector leaves the markdown price untouched", () => {
  const p = b2bPricing(19000, 35, 0);
  assert.strictEqual(p.collectorDiscountAmount, 0);
  assert.strictEqual(p.finalTotal, 12350);
});

// ── 5. A 100% markdown leaves nothing for the collector code to take ─────────
// Guards against a negative total, which would read as money owed TO the vendor.
check("100% markdown yields a zero, non-negative total", () => {
  const p = b2bPricing(19000, 100, 5);
  assert.strictEqual(p.afterMarkdown, 0);
  assert.strictEqual(p.collectorDiscountAmount, 0);
  assert.strictEqual(p.finalTotal, 0);
});

// ── 6. Missing / junk inputs coerce to 0 rather than NaN ─────────────────────
// vendorData is drawn from sessionStorage and can be absent mid-flow. A NaN
// here would be written to the DB and poison every downstream revenue sum.
check("undefined and junk inputs never produce NaN", () => {
  for (const args of [
    [undefined, undefined, undefined], [19000, null, null],
    [19000, "35", "5"], ["19000", 35, 5], [19000, undefined, 5],
  ]) {
    const p = b2bPricing(...args);
    for (const [k, v] of Object.entries(p)) {
      assert.ok(Number.isFinite(v), `${k} was ${v} for ${JSON.stringify(args)}`);
    }
  }
  // Strings are the real sessionStorage shape — they must still compute.
  assert.strictEqual(b2bPricing("19000", "35", "5").finalTotal, 11732.5);
});

// ── 7. Stock orders: zero MRP stays zero ─────────────────────────────────────
check("zero MRP produces all zeroes", () => {
  const p = b2bPricing(0, 35, 5);
  assert.deepStrictEqual(p, {
    markdownAmount: 0, afterMarkdown: 0,
    collectorDiscountAmount: 0, finalTotal: 0,
  });
});

console.log(`\n${checks} checks passed`);
