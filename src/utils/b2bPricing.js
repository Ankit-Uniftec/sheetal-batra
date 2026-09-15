// B2B order pricing: markdown, then collector code.
//
// THE ORDER OF THE TWO DISCOUNTS IS THE WHOLE POINT.
//
// Markdown comes off MRP. The collector code then comes off what is LEFT, not
// off MRP again — it is a further concession on an already-marked-down price,
// which is how it is quoted to the vendor ("35% off, and another 5% on that").
//
// Both were previously applied to the MRP in parallel, which over-discounted
// every B2B order carrying a collector code. On the ₹19,000 order that surfaced
// this, the collector 5% was ₹950 (5% of MRP) instead of ₹617.50 (5% of the
// ₹12,350 post-markdown price) — ₹332.50 given away on one line.
//
// Worked example — ₹19,000 MRP, 35% markdown, 5% collector:
//   markdown  = 19,000 × 35%  = 6,650   → 12,350 remains
//   collector = 12,350 ×  5%  =   617.50
//   final     = 19,000 − 6,650 − 617.50 = 11,732.50
//
// Rounding is deliberately NOT done here. Callers that only display a number
// round for display; the one caller that WRITES to the DB rounds once, at the
// write. Rounding inside would make the parts stop summing to the total.

export function b2bPricing(grandTotal, markdownPercent, collectorPercent) {
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
