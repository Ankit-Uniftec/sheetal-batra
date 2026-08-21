// Self-check for applyBreakdownOverride and the barcode minting it feeds.
//
// This decides what the factory physically cuts for a draft-order line, from a
// human's answer with no upstream record to check it against — so the branch
// gets a runnable check. Case 7 is the one that matters most: a standalone
// dupatta must mint ONE DUP barcode and no phantom TOP.
//
// Run (needs the TS compiled to JS first, since Deno types don't run in node):
//   npx tsc supabase/functions/shopify-order-sync/mapper.ts --outDir /tmp/m //     --target es2022 --module esnext --skipLibCheck --noEmitOnError false
//   node supabase/functions/shopify-order-sync/breakdown.test.mjs
import assert from "node:assert/strict";
import { applyBreakdownOverride } from "./mapper.mjs";

const item = (name, extra = {}) => ({
  product_name: name, top: "", bottom: "", includes_dupatta: false,
  quantity: 1, ...extra,
});
const styleBlocker = (name) => ({
  code: "PRODUCT_STYLE_MISSING",
  detail: `No top_style/bottom_style on "${name}" ()`,
});

// 1. Dupatta-only override → dupatta true, no top/bottom, blocker cleared.
{
  const r = applyBreakdownOverride(
    { items: [item("LIghter Dupatta")], blockers: [styleBlocker("LIghter Dupatta")] },
    [{ item_index: 0, top: "", bottom: "", includes_dupatta: true }],
  );
  assert.equal(r.items[0].includes_dupatta, true);
  assert.equal(r.items[0].top, "");
  assert.equal(r.items[0].bottom, "");
  assert.equal(r.blockers.length, 0, "style blocker should clear");
  assert.equal(r.items[0].breakdown_source, "manual");
}

// 2. Top+Bottom override → both pieces, blocker cleared.
{
  const r = applyBreakdownOverride(
    { items: [item("Choga With Salwar")], blockers: [styleBlocker("Choga With Salwar")] },
    [{ item_index: 0, top: "Top", bottom: "Bottom", includes_dupatta: false }],
  );
  assert.equal(r.items[0].top, "Top");
  assert.equal(r.items[0].bottom, "Bottom");
  assert.equal(r.items[0].includes_dupatta, false);
  assert.equal(r.blockers.length, 0);
}

// 3. Multi-line: only the answered line clears; the other stays flagged.
{
  const r = applyBreakdownOverride(
    {
      items: [item("Dupatta A"), item("Outfit B")],
      blockers: [styleBlocker("Dupatta A"), styleBlocker("Outfit B")],
    },
    [{ item_index: 0, top: "", bottom: "", includes_dupatta: true }],
  );
  assert.equal(r.blockers.length, 1, "unanswered line must stay flagged");
  assert.ok(r.blockers[0].detail.includes("Outfit B"));
  assert.equal(r.items[1].includes_dupatta, false, "untouched line unchanged");
}

// 4. An override naming NO piece is ignored — must not clear the blocker and
//    then mint zero barcodes.
{
  const r = applyBreakdownOverride(
    { items: [item("Dupatta A")], blockers: [styleBlocker("Dupatta A")] },
    [{ item_index: 0, top: "", bottom: "", includes_dupatta: false }],
  );
  assert.equal(r.blockers.length, 1, "empty answer must not clear the blocker");
}

// 5. Unrelated blockers survive.
{
  const other = { code: "CUSTOMER_UNRESOLVED", detail: "no phone" };
  const r = applyBreakdownOverride(
    { items: [item("Dupatta A")], blockers: [styleBlocker("Dupatta A"), other] },
    [{ item_index: 0, top: "", bottom: "", includes_dupatta: true }],
  );
  assert.deepEqual(r.blockers, [other]);
}

// 6. No override / malformed → untouched.
{
  const input = { items: [item("X")], blockers: [styleBlocker("X")] };
  assert.equal(applyBreakdownOverride(input, null).blockers.length, 1);
  assert.equal(applyBreakdownOverride(input, []).blockers.length, 1);
  assert.equal(applyBreakdownOverride(input, [{ item_index: "x" }]).blockers.length, 1);
}

// 7. The minting contract: a dupatta-only line yields exactly ONE DUP barcode.
//    Mirrors generateOrderComponents' branch conditions.
{
  const hasGarmentOption = (v) => !!v && !["na", "n/a", ""].includes(String(v).toLowerCase());
  const mint = (it) => {
    const out = [];
    const namesNoPiece = !hasGarmentOption(it.top) && !hasGarmentOption(it.bottom) && !it.includes_dupatta;
    if (hasGarmentOption(it.top) || (namesNoPiece && it.product_name)) out.push("TOP");
    if (hasGarmentOption(it.bottom)) out.push("BTM");
    if (it.includes_dupatta) out.push("DUP");
    return out;
  };
  const r = applyBreakdownOverride(
    { items: [item("LIghter Dupatta")], blockers: [styleBlocker("LIghter Dupatta")] },
    [{ item_index: 0, top: "", bottom: "", includes_dupatta: true }],
  );
  assert.deepEqual(mint(r.items[0]), ["DUP"], "standalone dupatta = 1 DUP barcode, no phantom TOP");

  const r2 = applyBreakdownOverride(
    { items: [item("Choga With Salwar")], blockers: [] },
    [{ item_index: 0, top: "Top", bottom: "Bottom", includes_dupatta: true }],
  );
  assert.deepEqual(mint(r2.items[0]), ["TOP", "BTM", "DUP"]);
}

// 8. MULTI-PRODUCT orders: each line is answered independently, the order only
//    clears when every typed line has an answer, and barcodes stay distinct.
{

const item = (name, pid = null) => ({
  product_name: name, top: "", bottom: "", includes_dupatta: false,
  quantity: 1, shopify_product_id: pid,
});
const blk = (n) => ({ code: "PRODUCT_STYLE_MISSING", detail: `No top_style/bottom_style on "${n}" ()` });

// A 3-line order: two typed lines + one real catalogue product.
const order = {
  items: [item("LIghter Dupatta"), item("Choga With Salwar"), item("Real Kurta", "gid://x/1")],
  blockers: [blk("LIghter Dupatta"), blk("Choga With Salwar")],
};

// Answer ONLY line 0. Line 1 must stay flagged.
let r = applyBreakdownOverride(order, [
  { item_index: 0, top: "", bottom: "", includes_dupatta: true },
]);
assert.equal(r.items[0].includes_dupatta, true, "line 0 answered");
assert.equal(r.items[1].includes_dupatta, false, "line 1 untouched");
assert.equal(r.items[2].product_name, "Real Kurta", "catalogue line untouched");
assert.equal(r.blockers.length, 1, "line 1 still flagged");
assert.ok(r.blockers[0].detail.includes("Choga With Salwar"));

// Now answer line 1 too, as the UI does — merging, not replacing.
r = applyBreakdownOverride(order, [
  { item_index: 0, top: "", bottom: "", includes_dupatta: true },
  { item_index: 1, top: "Top", bottom: "Bottom", includes_dupatta: false },
]);
assert.equal(r.blockers.length, 0, "both answered -> order clears");
assert.equal(r.items[0].includes_dupatta, true);
assert.equal(r.items[1].top, "Top");
assert.equal(r.items[1].bottom, "Bottom");

// Barcodes must be distinct per line (item_index drives the suffix).
const mint = (it, i) => {
  const has = (v) => !!v && !["na", "n/a", ""].includes(String(v).toLowerCase());
  const sfx = i > 0 ? i + 1 : "";
  const out = [];
  const none = !has(it.top) && !has(it.bottom) && !it.includes_dupatta;
  if (has(it.top) || (none && it.product_name)) out.push(`TOP${sfx}`);
  if (has(it.bottom)) out.push(`BTM${sfx}`);
  if (it.includes_dupatta) out.push(`DUP${sfx}`);
  return out;
};
const codes = r.items.flatMap(mint);
assert.deepEqual(codes, ["DUP", "TOP2", "BTM2", "TOP3"]);
assert.equal(new Set(codes).size, codes.length, "no duplicate barcodes across lines");


}

console.log("all breakdown checks passed");
