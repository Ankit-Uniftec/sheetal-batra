// Self-check for non-shipped CHARGE lines (customisations).
//
// The store sells "Neck and size customisation" / "Sleeves customisation" as
// their own order lines. They are money and instructions, not garments: nothing
// is cut, scanned or packed. Getting this wrong mints barcodes for garments
// that do not exist, and every active component must clear Final QC before an
// order can be packed — so a phantom tag blocks the whole order.
//
// Fixture values are REAL, from order #27567 (verified against the Shopify
// Admin API): garment requiresShipping true, both customisations false.
//
// Run (needs the TS compiled to JS first, since Deno types don't run in node):
//   npx tsc supabase/functions/shopify-order-sync/mapper.ts --outDir /tmp/m \
//     --target es2022 --module esnext --skipLibCheck --noEmitOnError false
//   node supabase/functions/shopify-order-sync/charge.test.mjs
import assert from "node:assert/strict";
import {
  isNonShippedCharge,
  buildOrderComponents,
  applyBreakdownOverride,
  mapShopifyOrder,
} from "./mapper.mjs";

// ── isNonShippedCharge ──────────────────────────────────────

// 1. Shopify said false → a charge.
assert.equal(isNonShippedCharge({ requiresShipping: false }), true);

// 2. Shopify said true → a garment.
assert.equal(isNonShippedCharge({ requiresShipping: true }), false);

// 3. ABSENT is not "charge". Every order synced before the field was added to
//    the query has it undefined; treating those as charges would silently drop
//    real garments out of production. This is the one that must not regress.
assert.equal(isNonShippedCharge({}), false);
assert.equal(isNonShippedCharge({ requiresShipping: null }), false);
assert.equal(isNonShippedCharge(null), false);

// 4. No truthiness shortcuts — a string "false" is not a Shopify boolean.
assert.equal(isNonShippedCharge({ requiresShipping: "false" }), false);

// ── buildOrderComponents ────────────────────────────────────

const order27567 = {
  id: "o1",
  order_no: "SB-SHOPIFY-0826-005456",
  items: [
    {
      product_name: "Shabnam - Daisy Ivory Kurta Set with Sharara & Dupatta",
      top: "Kurta",
      bottom: "Sharara",
      includes_dupatta: true,
      quantity: 1,
      is_charge: false,
    },
    { product_name: "Neck and size customisation", top: "", bottom: "", includes_dupatta: false, quantity: 1, is_charge: true },
    { product_name: "Sleeves customisation", top: "", bottom: "", includes_dupatta: false, quantity: 1, is_charge: true },
  ],
};

// 5. THE bug. Three lines, but only the garment is made: TOP/BTM/DUP and
//    nothing else. Before the fix this minted 6 barcodes.
{
  const c = buildOrderComponents(order27567);
  assert.deepEqual(
    c.map((x) => x.barcode).sort(),
    ["SHOPIFY-005456-BTM", "SHOPIFY-005456-DUP", "SHOPIFY-005456-TOP"],
  );
  // Nothing carries a customisation label onto the floor.
  assert.equal(c.some((x) => /customisation/i.test(x.component_label)), false);
}

// 6. Suffixes stay keyed on item_index, NOT a re-numbered garment position. A
//    barcode must trace back to its line, and renumbering would change an
//    already-printed tag when an order later gains a charge.
{
  const c = buildOrderComponents({
    id: "o2",
    order_no: "SB-SHOPIFY-0826-000900",
    items: [
      { product_name: "Charge", top: "", bottom: "", quantity: 1, is_charge: true },
      { product_name: "Kurta Set", top: "Kurta", bottom: "Salwar", quantity: 1, is_charge: false },
    ],
  });
  assert.deepEqual(c.map((x) => x.barcode), [
    "SHOPIFY-000900-TOP2",
    "SHOPIFY-000900-BTM2",
  ]);
  assert.equal(c[0].item_index, 1);
}

// 7. An order of ONLY charges makes nothing. No product_name TOP fallback.
{
  const c = buildOrderComponents({
    id: "o3",
    order_no: "SB-SHOPIFY-0826-000901",
    items: [{ product_name: "Sleeves customisation", top: "", bottom: "", quantity: 1, is_charge: true }],
  });
  assert.equal(c.length, 0);
}

// 8. Garments are untouched — no is_charge flag at all (a pre-fix stored order)
//    still mints exactly as before.
{
  const c = buildOrderComponents({
    id: "o4",
    order_no: "SB-SHOPIFY-0726-000118",
    items: [{ product_name: "Kurta Set", top: "Kurta", bottom: "Salwar", includes_dupatta: true, quantity: 1 }],
  });
  assert.equal(c.length, 3);
}

// ── applyBreakdownOverride ──────────────────────────────────

// 9. The stored override on #27567 types "Top"/"Bottom" onto both charge lines.
//    It is replayed on every remap, so it MUST NOT resurrect them as garments.
{
  const r = applyBreakdownOverride(
    { items: order27567.items.map((i) => ({ ...i })), blockers: [] },
    [
      { item_index: 1, top: "Top", bottom: "Bottom", includes_dupatta: true },
      { item_index: 2, top: "Top", bottom: "Bottom", includes_dupatta: true },
    ],
  );
  assert.equal(r.items[1].top, "");
  assert.equal(r.items[1].includes_dupatta, false);
  assert.equal(r.items[2].top, "");
  // And the guard survives all the way through to minting.
  const c = buildOrderComponents({ ...order27567, items: r.items });
  assert.equal(c.length, 3);
}

// 10. A genuine override on a real garment line still applies.
{
  const r = applyBreakdownOverride(
    { items: [{ product_name: "Mystery", top: "", bottom: "", quantity: 1, is_charge: false }], blockers: [] },
    [{ item_index: 0, top: "Kurta", bottom: "Salwar" }],
  );
  assert.equal(r.items[0].top, "Kurta");
  assert.equal(r.items[0].breakdown_source, "manual");
}

// ── End-to-end on the real #27567 payload ───────────────────

// Real values, verified against the Shopify Admin API.
const money = (a) => ({ shopMoney: { amount: String(a) } });
const li = (title, price, requiresShipping, product) => ({
  node: {
    title, quantity: 1, requiresShipping,
    originalUnitPriceSet: money(price),
    discountedUnitPriceSet: money(price),
    customAttributes: [],
    variant: product
      ? { id: "v1", selectedOptions: [{ name: "Size", value: "Custom" }], product }
      : null,
  },
});

const raw27567 = {
  id: "gid://shopify/Order/1",
  name: "#27567",
  createdAt: "2026-08-19T10:00:00Z",
  displayFinancialStatus: "PAID",
  paymentGatewayNames: ["razorpay"],
  phone: "+919876543210",
  // Paid 240500, of which 12000 was discounted off a 252500 list.
  totalPriceSet: money(240500),
  subtotalPriceSet: money(240500),
  totalTaxSet: money(0),
  totalDiscountsSet: money(12000),
  totalShippingPriceSet: money(0),
  lineItems: {
    edges: [
      li("Shabnam - Daisy Ivory Kurta Set with Sharara & Dupatta", 225000, true, {
        id: "p1",
        title: "Shabnam - Daisy Ivory Kurta Set with Sharara & Dupatta",
        tags: ["WITH DUPATTA", "Suit Sets"],
        topStyle: { value: "Kurta" },
        bottomStyle: { value: "Sharara" },
      }),
      li("Neck and size customisation", 17500, false, null),
      li("Sleeves customisation", 10000, false, null),
    ],
  },
};

// 11. One garment, not three. This is the reported bug.
{
  const { orderRow, blockers } = mapShopifyOrder(raw27567);
  assert.equal(orderRow.total_quantity, 1);

  // 12. No review. The charges used to raise PRODUCT_STYLE_MISSING and
  //     DUPATTA_UNKNOWN, which is what sent a human to type placeholder styles.
  assert.deepEqual(blockers, []);
  assert.equal(orderRow.web_order_status, "ready");

  // 13. MONEY. grand_total is pre-discount; net is what was paid. Holding the
  //     paid figure in grand_total made the invoice subtract the discount twice
  //     and print ₹2,28,500 against ₹2,40,500 actually taken.
  assert.equal(orderRow.grand_total, 252500);
  assert.equal(orderRow.discount_amount, 12000);
  assert.equal(orderRow.net_total, 240500);
  assert.equal(orderRow.grand_total_after_discount, 240500);
  // The invoice's own arithmetic, CustomerOrderPdf.js:450.
  assert.equal(orderRow.grand_total - orderRow.discount_amount, 240500);
  // Fully paid, nothing outstanding.
  assert.equal(orderRow.advance_payment, 240500);
  assert.equal(orderRow.remaining_payment, 0);

  // 14. The charge is still on the order — it is revenue, not noise.
  assert.equal(orderRow.items.length, 3);
  assert.equal(orderRow.items[1].price, 17500);
  assert.equal(orderRow.items[1].is_charge, true);
  assert.equal(orderRow.items[0].is_charge, false);

  // 15. The tailor is told. Both titles reach the garment's notes, which
  //     mergeOrderNotes() prints on the warehouse PDF and the order card.
  assert.match(orderRow.items[0].notes, /Neck and size customisation/);
  assert.match(orderRow.items[0].notes, /Sleeves customisation/);
  // ...and a charge does not carry its own instruction back to itself.
  assert.equal(/Customisation ordered/.test(orderRow.items[1].notes || ""), false);

  // 16. Three barcodes for the one real garment.
  const c = buildOrderComponents({ id: "x", order_no: "SB-SHOPIFY-0826-005456", items: orderRow.items });
  assert.equal(c.length, 3);
}

// 17. An order with NO charges is completely unaffected — same money, same
//     notes, no stray "Customisation ordered" text.
{
  const plain = {
    ...raw27567,
    totalPriceSet: money(225000),
    totalDiscountsSet: money(0),
    lineItems: { edges: [raw27567.lineItems.edges[0]] },
  };
  const { orderRow } = mapShopifyOrder(plain);
  assert.equal(orderRow.total_quantity, 1);
  assert.equal(orderRow.grand_total, 225000);
  assert.equal(orderRow.net_total, 225000);
  assert.equal(orderRow.items[0].notes, "");
}

console.log("charge.test.mjs — all assertions passed");
