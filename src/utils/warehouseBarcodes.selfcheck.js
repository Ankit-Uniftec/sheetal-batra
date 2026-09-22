// Self-check for the "a warehouse PDF never prints without barcodes" rule.
// No test framework in this repo (src/App.test.js is the stock CRA smoke test),
// so this is a plain node script, same convention as
// ensureOrderComponents.selfcheck.js:
//
//     node src/utils/warehouseBarcodes.selfcheck.js
//
// Why this exists — order SB-DLC-0926-008466 printed two warehouse work orders
// with no barcodes on them. Component minting at placement is deliberately
// non-blocking (the order must persist even if barcodes fail), so the order
// reached the PDF with zero order_components rows. pdfUtils swallowed that in a
// `catch`, and WarehouseOrderPdf quietly fell back to a page of placeholder
// boxes printing the order number as plain TEXT. The document looked normal, so
// nobody noticed until the floor tried to scan it — and by then every reprint
// served the same unscannable PDF, because nothing re-minted the components.
//
// Two guarantees are asserted here, in opposite directions:
//
//   - NEVER render a barcode-less work order. An unscannable garment cannot be
//     advanced through a single production stage; failing loudly beats printing
//     a document that silently drops it out of tracking.
//
//   - Still render normally when barcodes ARE present, including the
//     multi-item case where each PDF gets only its own item's barcodes.

const assert = require("assert");

// ── Mirrors of the two guards under test ────────────────────────────────
// Both files are ESM and pull in @react-pdf/renderer + the Supabase client, so
// the guard logic is re-declared rather than dragging in a transpiler. Keep in
// step with WarehouseOrderPdf.js and pdfUtils.js fetchWarehouseBarcodes().

// WarehouseOrderPdf.js — refuses to render without barcodes.
function renderWarehousePdf({ order, item, itemIndex = 0, componentBarcodes = [] }) {
  if (!order || !item) return "error-page";
  if (!componentBarcodes || componentBarcodes.length === 0) {
    throw new Error(
      `WarehouseOrderPdf: no component barcodes for ${order.order_no} (item ${itemIndex + 1}). ` +
      `Refusing to render an unscannable work order.`
    );
  }
  return { pages: componentBarcodes.length };
}

// pdfUtils.js fetchWarehouseBarcodes — self-heals, then insists.
async function fetchWarehouseBarcodes(order, ensureOrderComponents) {
  const components = await ensureOrderComponents(order);
  if (!components || components.length === 0) {
    throw new Error(
      `No barcode components exist for ${order?.order_no} and none could be created. ` +
      `The warehouse PDF would print without scannable barcodes, so it was not generated.`
    );
  }
  return { components };
}

const ORDER = { order_no: "SB-DLC-0926-008466" };
const ITEM = { product_name: "Kurta Set" };

// ── 1. The 008466 bug: zero barcodes must NOT produce a document ────────
assert.throws(
  () => renderWarehousePdf({ order: ORDER, item: ITEM, componentBarcodes: [] }),
  /Refusing to render an unscannable work order/,
  "empty componentBarcodes must throw, not fall back to placeholder boxes"
);

// Callers that omit the prop entirely hit the same guard (it defaults to []).
assert.throws(
  () => renderWarehousePdf({ order: ORDER, item: ITEM }),
  /Refusing to render an unscannable work order/,
  "omitted componentBarcodes must throw too"
);

// The error has to name the order, or an operator cannot act on it.
assert.throws(
  () => renderWarehousePdf({ order: ORDER, item: ITEM, componentBarcodes: [] }),
  /SB-DLC-0926-008466/,
  "the refusal must name the order"
);

// ── 2. Barcodes present → renders, one page per component ───────────────
const twoPieces = [
  { barcode: "DLC-008466-TOP", label: "Kurta", image: "data:image/png;base64,AAA" },
  { barcode: "DLC-008466-BTM", label: "Pants", image: "data:image/png;base64,BBB" },
];
assert.deepStrictEqual(
  renderWarehousePdf({ order: ORDER, item: ITEM, componentBarcodes: twoPieces }),
  { pages: 2 },
  "a normal order still renders one page per component"
);

// Missing/unloaded order data keeps its own existing error page — the barcode
// guard must not swallow that distinct failure.
assert.strictEqual(
  renderWarehousePdf({ order: null, item: null, componentBarcodes: [] }),
  "error-page",
  "missing order/item keeps its own error page"
);

// ── 3. Self-heal: minting recovers an order that lost its components ─────
(async () => {
  // The 008466 state — DB has nothing, ensureOrderComponents mints it back.
  let minted = false;
  const healing = async () => {
    minted = true;
    return [{ barcode: "DLC-008466-TOP", item_index: 0 }];
  };
  const healed = await fetchWarehouseBarcodes(ORDER, healing);
  assert.ok(minted, "must attempt to mint, not just read");
  assert.strictEqual(healed.components.length, 1, "minted components are returned");

  // If minting genuinely cannot produce anything, refuse — do not hand an
  // empty set downstream where it would become a placeholder PDF.
  await assert.rejects(
    () => fetchWarehouseBarcodes(ORDER, async () => []),
    /was not generated/,
    "an unfixable order must abort PDF generation"
  );

  // A real minting failure (RLS, network) propagates rather than being
  // swallowed the way the original `catch` did.
  await assert.rejects(
    () => fetchWarehouseBarcodes(ORDER, async () => { throw new Error("RLS denied"); }),
    /RLS denied/,
    "minting errors must propagate, not be swallowed"
  );

  // ── 4. Multi-item: each PDF gets only its own item's barcodes ──────────
  // 008466 had two products. Barcodes are filtered by item_index, so a filter
  // that returns nothing for an item must hit the guard rather than print a
  // placeholder page for that one product.
  const components = [
    { barcode: "DLC-008466-TOP", item_index: 0 },
    { barcode: "DLC-008466-TOP2", item_index: 1 },
  ];
  const forItem = (idx) =>
    components.filter((c) => c.item_index === idx).map((c) => ({ ...c, image: "data:x" }));

  assert.deepStrictEqual(
    renderWarehousePdf({ order: ORDER, item: ITEM, itemIndex: 1, componentBarcodes: forItem(1) }),
    { pages: 1 },
    "second product renders from its own barcodes"
  );
  assert.throws(
    () => renderWarehousePdf({ order: ORDER, item: ITEM, itemIndex: 2, componentBarcodes: forItem(2) }),
    /item 3/,
    "an item whose barcodes are missing must refuse, naming that item"
  );

  console.log("warehouse barcode self-check: all assertions passed");
})();
