// Self-check for the remap-items mint guard.
//
// remap-items is the ONLY path that clears needs_review -> ready (a human sets
// the breakdown on the Needs Review card). Ingestion skips minting for a
// flagged order, so before this guard existed such an order became ready with
// a full top/bottom breakdown and zero barcodes — no pieces, no View Journey.
// The guard is two conditions; both matter, so both get checked.
//
// Run: node supabase/functions/shopify-order-sync/remapMint.test.mjs
import assert from "node:assert/strict";

// Mirrors the guard in index.ts (mode === "remap-items").
const shouldMint = (upErr, status) => !upErr && status !== "needs_review";

// Cleared to ready -> mint. This is the bug being fixed.
assert.equal(shouldMint(null, "ready"), true);

// Still flagged -> do NOT mint: the breakdown isn't trustworthy, and minting
// from it would print one mislabelled barcode for a multi-piece garment.
assert.equal(shouldMint(null, "needs_review"), false);

// Update failed -> do NOT mint against items[] the DB never accepted.
assert.equal(shouldMint({ message: "boom" }, "ready"), false);

console.log("remapMint: ok");
