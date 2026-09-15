// Self-check for the ensureOrderComponents "mint only what's missing" rule.
// There is no test framework in this repo (src/App.test.js is the stock CRA
// smoke test), so this is a plain node script:
//
//     node src/utils/ensureOrderComponents.selfcheck.js
//
// It exists because these rows ARE the physical garments. Two failure modes
// matter, in opposite directions:
//
//   - Minting too FEW: a piece added to an order after approval (a product
//     whose has_dupatta is corrected to true) never gets a barcode, so the
//     garment cannot be scanned and silently falls out of production. That is
//     the bug this was written to fix — order SB-B2B-0926-007222.
//
//   - Minting too MANY: re-minting a barcode that already exists collides on
//     the unique key, and worse, would reset a garment that has already been
//     printed, scanned and advanced through the line.

const assert = require("assert");

// barcodeService.js is ESM and pulls in the Supabase client, so the pure
// row-building logic is re-declared here rather than dragging in a transpiler —
// the same convention itemNetAmount.selfcheck.js uses. Keep in step with
// buildOrderComponents() in barcodeService.js.
const hasGarmentOption = (v) => {
  const s = (v ?? "").toString().trim();
  return s !== "" && !["na", "n/a", "n.a.", "none", "-"].includes(s.toLowerCase());
};

// Alterations append "-A"/"-A<n>", so a naive split().pop() would return "A"
// as the sequence and mint a colliding barcode root.
function getBarcodeRoot(orderNo) {
  const parts = (orderNo || "").split("-");
  const storeCode = parts[1] || "SB";
  const last = parts[parts.length - 1] || "";
  const isAlterationSuffix = /^A\d*$/i.test(last) && parts.length > 4;
  const seqPart = isAlterationSuffix
    ? `${parts[parts.length - 2] || "000000"}${last.toUpperCase()}`
    : (last || "000000");
  return { storeCode, seqPart };
}

function buildOrderComponents(order) {
  const components = [];
  const { storeCode, seqPart } = getBarcodeRoot(order.order_no);
  const items = Array.isArray(order.items) ? order.items : [order.items];

  items.forEach((item, itemIndex) => {
    const suffix = itemIndex > 0 ? itemIndex + 1 : "";
    const namesNoPiece =
      !hasGarmentOption(item?.top) &&
      !hasGarmentOption(item?.bottom) &&
      !item?.includes_dupatta &&
      !(Array.isArray(item?.extras) && item.extras.length > 0);

    if (hasGarmentOption(item?.top) || (namesNoPiece && item?.product_name)) {
      components.push({ barcode: `${storeCode}-${seqPart}-TOP${suffix}`, component_type: "top" });
    }
    if (hasGarmentOption(item?.bottom)) {
      components.push({ barcode: `${storeCode}-${seqPart}-BTM${suffix}`, component_type: "bottom" });
    }
    if (item?.includes_dupatta) {
      components.push({ barcode: `${storeCode}-${seqPart}-DUP${suffix}`, component_type: "dupatta" });
    }
    (Array.isArray(item?.extras) ? item.extras : []).forEach((extra, ei) => {
      components.push({
        barcode: `${storeCode}-${seqPart}-EX${ei + 1}${itemIndex > 0 ? "-" + (itemIndex + 1) : ""}`,
        component_type: "extra",
      });
    });
  });
  return components;
}

// The decision under test: given what's already stored, what gets inserted?
const missingFor = (order, existing) => {
  const have = new Set(existing.map((c) => c.barcode));
  return buildOrderComponents(order).filter((c) => !have.has(c.barcode));
};

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log("  ok  " + name); };

console.log("ensureOrderComponents self-check\n");

// ── 1. The order that surfaced the bug ───────────────────────────────────────
// SB-B2B-0926-007222, "Nafisah - Daisy Ivory Kurta Set": Kurta + Salwar were
// minted at approval, then the product's has_dupatta was corrected to true.
// The DUP barcode must now appear — and TOP/BTM must NOT be re-minted.
check("adds the late dupatta without re-minting the printed pieces", () => {
  const order = {
    order_no: "SB-B2B-0926-007222",
    items: [{ product_name: "Nafisah - Daisy Ivory Kurta Set", top: "Kurta", bottom: "Salwar", includes_dupatta: true }],
  };
  const existing = [{ barcode: "B2B-007222-TOP" }, { barcode: "B2B-007222-BTM" }];
  const missing = missingFor(order, existing);
  assert.deepStrictEqual(missing.map((c) => c.barcode), ["B2B-007222-DUP"]);
  assert.strictEqual(missing[0].component_type, "dupatta");
});

// ── 2. The old behaviour is genuinely gone ───────────────────────────────────
// Pinned so a revert to "any row exists → return []" fails loudly here.
check("does not bail out merely because some components exist", () => {
  const order = {
    order_no: "SB-B2B-0926-007222",
    items: [{ top: "Kurta", bottom: "Salwar", includes_dupatta: true }],
  };
  assert.notStrictEqual(missingFor(order, [{ barcode: "B2B-007222-TOP" }]).length, 0);
});

// ── 3. Nothing to do when the order is already complete ──────────────────────
// The re-approval path fires repeatedly; it must stay a genuine no-op.
check("a fully-minted order mints nothing", () => {
  const order = {
    order_no: "SB-B2B-0926-007222",
    items: [{ top: "Kurta", bottom: "Salwar", includes_dupatta: true }],
  };
  const existing = ["TOP", "BTM", "DUP"].map((s) => ({ barcode: `B2B-007222-${s}` }));
  assert.deepStrictEqual(missingFor(order, existing), []);
});

// ── 4. A garment mid-production is never re-minted ───────────────────────────
// Re-inserting a scanned barcode would collide on the unique key and reset a
// real garment's journey. Existing rows are matched on barcode alone, so their
// stage/status is irrelevant — they are simply never in the missing set.
check("an advanced, scanned component is left untouched", () => {
  const order = { order_no: "SB-B2B-0926-007222", items: [{ top: "Kurta", includes_dupatta: true }] };
  const existing = [{ barcode: "B2B-007222-TOP", current_stage: "Stitching", status: "in_progress" }];
  const missing = missingFor(order, existing);
  assert.deepStrictEqual(missing.map((c) => c.barcode), ["B2B-007222-DUP"]);
});

// ── 5. Multi-item orders keep their index suffixes ───────────────────────────
// Item 2's dupatta is DUP2, not DUP — collapsing them would collide.
check("late dupatta on the second item mints DUP2", () => {
  const order = {
    order_no: "SB-DLC-0926-003625",
    items: [
      { top: "Kurta", bottom: "Sharara", includes_dupatta: true },
      { top: "Kurta", bottom: "Salwar", includes_dupatta: true },
    ],
  };
  const existing = ["TOP", "BTM", "DUP", "TOP2", "BTM2"].map((s) => ({ barcode: `DLC-003625-${s}` }));
  assert.deepStrictEqual(missingFor(order, existing).map((c) => c.barcode), ["DLC-003625-DUP2"]);
});

// ── 6. Removing a piece is NOT handled here ──────────────────────────────────
// has_dupatta turned back off must not delete a barcode that may already be on
// a physical tag. This function only ever adds.
check("a no-longer-wanted dupatta is not deleted", () => {
  const order = { order_no: "SB-B2B-0926-007222", items: [{ top: "Kurta", bottom: "Salwar", includes_dupatta: false }] };
  const existing = ["TOP", "BTM", "DUP"].map((s) => ({ barcode: `B2B-007222-${s}` }));
  assert.deepStrictEqual(missingFor(order, existing), []);
});

// ── 7. Extras are matched on their own barcodes ──────────────────────────────
check("a late extra mints only the new EX barcode", () => {
  const order = {
    order_no: "SB-B2B-0926-007222",
    items: [{ top: "Kurta", extras: [{ name: "Belt" }, { name: "Cape" }] }],
  };
  const existing = [{ barcode: "B2B-007222-TOP" }, { barcode: "B2B-007222-EX1" }];
  assert.deepStrictEqual(missingFor(order, existing).map((c) => c.barcode), ["B2B-007222-EX2"]);
});

// ── 8. A standalone dupatta still mints no phantom TOP ───────────────────────
// The "NA top + NA bottom" case that created phantom garments historically.
check("standalone dupatta mints DUP only, never a phantom TOP", () => {
  const order = {
    order_no: "SB-DLC-0926-003625",
    items: [{ product_name: "Lighter Dupatta", top: "NA", bottom: "N/A", includes_dupatta: true }],
  };
  assert.deepStrictEqual(missingFor(order, []).map((c) => c.barcode), ["DLC-003625-DUP"]);
});

// ── 9. Alteration orders keep their A-suffixed root ──────────────────────────
// SB-DLC-0425-000376-A must mint DLC-000376A-DUP, not DLC-A-DUP. A naive
// split().pop() reads the sequence as "A" and collides across every alteration.
check("an alteration order's late dupatta uses the A-suffixed root", () => {
  const order = {
    order_no: "SB-DLC-0425-000376-A",
    items: [{ top: "Kurta", bottom: "Sharara", includes_dupatta: true }],
  };
  const existing = [{ barcode: "DLC-000376A-TOP" }, { barcode: "DLC-000376A-BTM" }];
  assert.deepStrictEqual(missingFor(order, existing).map((c) => c.barcode), ["DLC-000376A-DUP"]);
});

console.log(`\n${checks} checks passed`);
