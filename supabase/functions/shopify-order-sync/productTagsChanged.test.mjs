// Self-check for productTagsChanged — the gate that decides whether an
// already-stored snapshot gets rewritten because a product's TAGS moved in
// Shopify after the order was ingested.
//
// rawIsStale cannot answer this: it only ever sees the STORED blob, so it
// detects an absent key but never a changed value. That gap is what left six
// live orders without a dupatta barcode — the catalogue team added
// "WITH DUPATTA" after the orders came in, refresh-raw reported "stale: 0"
// because the tags key WAS present, and remap-items replayed the pre-tag blob
// forever, re-deriving "no dupatta" every time.
//
// Mirrors the function in index.ts (Deno-only, so it cannot be imported here) —
// the same convention rawStale.test.mjs uses.
//
// Run: node supabase/functions/shopify-order-sync/productTagsChanged.test.mjs
import assert from "node:assert/strict";

function productTagsChanged(storedRaw, node) {
  const tagsById = (raw) => {
    const m = new Map();
    for (const e of raw?.lineItems?.edges || []) {
      const p = e?.node?.variant?.product;
      if (!p?.id || !Array.isArray(p.tags)) continue;
      m.set(String(p.id), [...p.tags].map(String).sort().join("\n"));
    }
    return m;
  };
  const before = tagsById(storedRaw);
  if (before.size === 0) return false;
  const after = tagsById(node);
  for (const [id, sig] of before) {
    const now = after.get(id);
    if (now !== undefined && now !== sig) return true;
  }
  return false;
}

const raw = (products) => ({
  lineItems: { edges: products.map((product) => ({ node: { variant: { product } } })) },
});

// 1. THE case this exists for — order #28289 (SB-SHOPIFY-0926-007552).
//    Ingested 12 Sep with six tags; "WITH DUPATTA" added to the product later.
//    Must report changed, or the dupatta never gets a barcode.
{
  const SIX = [
    "__label:New Arrivals", "karva Chauth", "karwachauth",
    "rakhi edit 2026", "Roohani", "Shararas & Gararas",
  ];
  const stored = raw([{ id: "gid://shopify/Product/8479620104381", tags: SIX }]);
  const fresh = raw([{ id: "gid://shopify/Product/8479620104381", tags: ["WITH DUPATTA", ...SIX] }]);
  assert.equal(productTagsChanged(stored, fresh), true);
}

// 2. Unchanged tags must NOT read as a change. The reconcile poll re-presents
//    the same orders every 5 minutes; a false positive here rewrites every
//    snapshot 288 times a day — the write amplification the diff prevents.
{
  const t = ["Roohani", "WITH DUPATTA"];
  assert.equal(productTagsChanged(raw([{ id: "p1", tags: t }]), raw([{ id: "p1", tags: [...t] }])), false);
}

// 3. Re-ORDERED tags are not a change. Shopify does not promise tag order, so
//    comparing as a set is what keeps the poll quiet.
{
  const stored = raw([{ id: "p1", tags: ["a", "b", "c"] }]);
  const fresh = raw([{ id: "p1", tags: ["c", "a", "b"] }]);
  assert.equal(productTagsChanged(stored, fresh), false);
}

// 4. A REMOVED tag counts too — "WITH DUPATTA" taken off a product that should
//    never have had it is just as much a correction as adding one.
{
  const stored = raw([{ id: "p1", tags: ["WITH DUPATTA", "Roohani"] }]);
  const fresh = raw([{ id: "p1", tags: ["Roohani"] }]);
  assert.equal(productTagsChanged(stored, fresh), true);
}

// 5. A snapshot with no tags KEY is rawIsStale's job, not this one. Treating the
//    missing list as empty would report a change on every single run.
{
  const stored = raw([{ id: "p1", category: null }]);      // pre-query-change blob
  const fresh = raw([{ id: "p1", tags: ["WITH DUPATTA"] }]);
  assert.equal(productTagsChanged(stored, fresh), false);
}

// 6. Charge lines (variant:null) and deleted products carry no product node.
//    They must not crash or register as a change.
{
  const stored = { lineItems: { edges: [{ node: { variant: null } }] } };
  assert.equal(productTagsChanged(stored, stored), false);
}

// 7. Multi-line order: only ONE product re-tagged still has to trigger. Order
//    #28289's sibling (005267) is exactly this — 4 lines, 1 needing the fix.
{
  const stored = raw([
    { id: "p1", tags: ["Roohani"] },
    { id: "p2", tags: ["Sale"] },
  ]);
  const fresh = raw([
    { id: "p1", tags: ["Roohani"] },
    { id: "p2", tags: ["Sale", "WITH DUPATTA"] },
  ]);
  assert.equal(productTagsChanged(stored, fresh), true);
}

// 8. A product that VANISHED from the fresh node is a line-item change, which
//    rawIsStale and the items paths own. Not our signal — and never a crash.
{
  const stored = raw([{ id: "p1", tags: ["a"] }]);
  const fresh = raw([{ id: "p2", tags: ["b"] }]);
  assert.equal(productTagsChanged(stored, fresh), false);
}

console.log("productTagsChanged: all 8 checks passed");
