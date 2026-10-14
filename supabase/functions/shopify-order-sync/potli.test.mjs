// Self-check for potli lines: a potli with no top/bottom style mints ONE EX
// barcode and does not go to Needs Review (order #29467, "Potli mustard").
//
// Run (needs the TS compiled to JS first, since Deno types don't run in node):
//   npx tsc supabase/functions/shopify-order-sync/mapper.ts --outDir /tmp/m \
//     --target es2022 --module esnext --skipLibCheck --noEmitOnError false
//   node supabase/functions/shopify-order-sync/potli.test.mjs
import assert from "node:assert/strict";
import { isPotliName, mapShopifyOrder, buildOrderComponents } from "./mapper.mjs";

const money = (a) => ({ shopMoney: { amount: String(a) } });
const raw = (title, product) => ({
  id: "gid://shopify/Order/1",
  name: "#29467",
  createdAt: "2026-10-04T10:00:00Z",
  displayFinancialStatus: "PAID",
  phone: "+919876543210",
  totalPriceSet: money(5000),
  subtotalPriceSet: money(5000),
  totalTaxSet: money(0),
  totalDiscountsSet: money(0),
  totalShippingPriceSet: money(0),
  lineItems: {
    edges: [{
      node: {
        title, quantity: 1, requiresShipping: true,
        originalUnitPriceSet: money(5000),
        discountedUnitPriceSet: money(5000),
        customAttributes: [],
        variant: { id: "v1", selectedOptions: [], product: { id: "p1", title, tags: [], ...product } },
      },
    }],
  },
});
const codes = (blockers) => blockers.map((b) => b.code);

// 1. Name rule: a potli alone yes; an outfit that mentions a potli no.
assert.equal(isPotliName("Potli mustard"), true);
assert.equal(isPotliName("POTLI - Ivory"), true);
assert.equal(isPotliName("Kurta Set with Potli"), false);
assert.equal(isPotliName("Mustard Kurta"), false);

// 2. The reported order: no blocker, one EX barcode named after the product.
{
  const { orderRow, blockers } = mapShopifyOrder(raw("Potli mustard", {}));
  assert.equal(codes(blockers).includes("PRODUCT_STYLE_MISSING"), false);
  assert.equal(codes(blockers).includes("DUPATTA_UNKNOWN"), false);
  const c = buildOrderComponents({ id: "x", order_no: "SB-SHOPIFY-1026-010023", items: orderRow.items });
  assert.deepEqual(c.map((x) => x.barcode), ["SHOPIFY-010023-EX1"]);
  assert.equal(c[0].component_label, "Potli mustard");
}

// 3. A curated style always wins over the name.
{
  const { orderRow } = mapShopifyOrder(raw("Potli mustard", { topStyle: { value: "Kurta" } }));
  assert.equal(orderRow.items[0].top, "Kurta");
  assert.deepEqual(orderRow.items[0].extras, []);
}

// 4. A non-potli product with no styles still goes to review.
{
  const { blockers } = mapShopifyOrder(raw("Mustard Kurta", {}));
  assert.equal(codes(blockers).includes("PRODUCT_STYLE_MISSING"), true);
}

console.log("potli.test.mjs OK");
