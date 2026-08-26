// Self-check for rawIsStale — the gate that decides whether an ALREADY-STORED
// order gets its Shopify snapshot re-fetched.
//
// This is the reason a mapper fix can or cannot reach existing data. `refresh`
// only rewrites shopify_raw for orders this returns true for, and `remap-items`
// replays whatever shopify_raw holds — so a snapshot that predates a query
// change is replayed forever, re-deriving the same wrong answer, and the fix
// silently applies to new orders only.
//
// The requiresShipping case is exactly that: it is read from the LINE ITEM, and
// the charge lines it identifies have variant:null. A product-level test bails
// out on precisely the lines that matter.
//
// Mirrors the function in index.ts (Deno-only, so it cannot be imported here) —
// the same convention remapMint.test.mjs uses.
//
// Run: node supabase/functions/shopify-order-sync/rawStale.test.mjs
import assert from "node:assert/strict";

function rawIsStale(storedRaw) {
  const edges = storedRaw?.lineItems?.edges;
  if (!Array.isArray(edges) || edges.length === 0) return false;
  return edges.some((e) => {
    if (!("requiresShipping" in (e?.node || {}))) return true;
    const product = e?.node?.variant?.product;
    if (!product) return false;
    return !("tags" in product) || !("category" in product);
  });
}

const raw = (nodes) => ({ lineItems: { edges: nodes.map((node) => ({ node })) } });
const freshProduct = { id: "p1", tags: [], category: null };

// 1. THE case this was extended for. #27567's stored snapshot: a garment plus
//    two charge lines with variant:null, captured before requiresShipping was
//    queried. Previously returned FALSE — refresh skipped it, and the charge
//    fix could never reach the order.
{
  const stored = raw([
    { title: "Shabnam", variant: { product: freshProduct } },
    { title: "Neck and size customisation", variant: null },
    { title: "Sleeves customisation", variant: null },
  ]);
  assert.equal(rawIsStale(stored), true);
}

// 2. A fully current snapshot is NOT stale — or refresh re-fetches every order
//    on every sweep, which is the write amplification this check exists to
//    prevent.
{
  const stored = raw([
    { title: "Shabnam", requiresShipping: true, variant: { product: freshProduct } },
    { title: "Neck and size customisation", requiresShipping: false, variant: null },
  ]);
  assert.equal(rawIsStale(stored), false);
}

// 3. requiresShipping:false is an ANSWER, not an absence. A charge line whose
//    field was fetched must not read as stale forever.
{
  assert.equal(
    rawIsStale(raw([{ title: "Sleeves customisation", requiresShipping: false, variant: null }])),
    false,
  );
}

// 4. A charge line with NO requiresShipping key is stale even though it has no
//    product. This is the ordering that matters: the line-item check must run
//    BEFORE the `if (!product) return false` bail-out.
{
  assert.equal(rawIsStale(raw([{ title: "Sleeves customisation", variant: null }])), true);
}

// 5. The pre-existing product-level checks still work — a snapshot missing
//    `tags` or `category` is stale even when requiresShipping is present.
{
  assert.equal(
    rawIsStale(raw([{ requiresShipping: true, variant: { product: { id: "p", category: null } } }])),
    true,
  );
  assert.equal(
    rawIsStale(raw([{ requiresShipping: true, variant: { product: { id: "p", tags: [] } } }])),
    true,
  );
}

// 6. A deleted product (variant:null) on an otherwise current snapshot is not
//    staleness — it tells us nothing about the snapshot's age.
{
  assert.equal(rawIsStale(raw([{ requiresShipping: true, variant: null }])), false);
}

// 7. Degenerate inputs never crash and never claim staleness.
{
  assert.equal(rawIsStale(null), false);
  assert.equal(rawIsStale({}), false);
  assert.equal(rawIsStale({ lineItems: { edges: [] } }), false);
}

console.log("rawStale.test.mjs — all assertions passed");
