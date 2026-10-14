// Garment-breakdown choices for Shopify lines the mapper cannot read pieces
// from — moved here unchanged from ShopifyOrdersDashboard.jsx (Release 11) so
// the order card, the Breakdown Changes screen and the node self-test
// (suggestBreakdown.test.mjs) all share one list. Plain .mjs, no imports.

// ─── Manual garment breakdown (draft orders) ───────────────────────────────
// A Shopify DRAFT order can carry a custom line item: a name and a price typed
// by hand, with no product behind it. The mapper reads the garment breakdown
// from PRODUCT metafields, so for these lines there is nothing to read and the
// order flags PRODUCT_STYLE_MISSING forever — no re-sync can fix it, because
// the information does not exist upstream. Only a human knows whether
// "LIghter Dupatta" is one piece or two.
//
// So this offers the answer here, where the person is already looking at the
// product name, the notes and the customer. See 83_manual_line_breakdown.sql.

// Offered for a line with NO Shopify product, and also for a product line the
// mapper flagged PRODUCT_STYLE_MISSING. That second case is a catalogue gap
// (e.g. "Potli mustard" has no top/bottom style) which the team cannot always
// fix in Shopify; without this the order would stay in Needs Review forever.
// A line keeps the control once answered, so the blocker clearing does not
// hide the "Change" chip.
export const isManualLine = (item) => !item?.shopify_product_id;
export const canSetBreakdown = (order, item, idx) =>
  isManualLine(item) ||
  !!breakdownForItem(order, idx) ||
  (order?.web_order_issues || []).some(
    (i) => i.code === "PRODUCT_STYLE_MISSING" &&
      String(i.detail || "").includes(`"${item?.product_name}"`),
  );

// What a person can choose. These map onto the three fields
// generateOrderComponents already consumes (top / bottom / includes_dupatta),
// so nothing new has to learn how to mint a barcode.
export const BREAKDOWN_CHOICES = [
  {
    key: "dupatta_only",
    label: "Dupatta only",
    hint: "1 barcode",
    value: { top: "", bottom: "", includes_dupatta: true },
  },
  {
    key: "top_bottom",
    label: "Top + Bottom",
    hint: "2 barcodes",
    value: { top: "Top", bottom: "Bottom", includes_dupatta: false },
  },
  {
    key: "top_bottom_dupatta",
    label: "Top + Bottom + Dupatta",
    hint: "3 barcodes",
    value: { top: "Top", bottom: "Bottom", includes_dupatta: true },
  },
  {
    key: "top_only",
    label: "Top only",
    hint: "1 barcode",
    value: { top: "Top", bottom: "", includes_dupatta: false },
  },
  {
    key: "bottom_only",
    label: "Bottom only",
    hint: "1 barcode",
    value: { top: "", bottom: "Bottom", includes_dupatta: false },
  },
  // A line that is no garment at all — a belt, a potli, a brooch. Minting it
  // as a TOP would put a garment barcode on a non-garment; the EX piece is the
  // honest unit, and it carries the typed name (the only description there is).
  {
    key: "extras_only",
    label: "Extras only",
    hint: "1 barcode",
    value: { top: "", bottom: "", includes_dupatta: false, includes_extra: true },
  },
];

// ─── Suggesting a breakdown from the typed name ────────────────────────────
// A typed line has no product, so the NAME is the only signal there is. Reading
// it to pre-select an answer is fair; reading it to DECIDE silently is not —
// these names are free text with no vocabulary ("LIghter Dupatta", "mohsina
// orange - only dupatta"), and a wrong guess mints barcodes that get printed
// and stuck on fabric before anyone notices. ensureComponents never deletes a
// barcode for that reason.
//
// So this suggests, and a person confirms with one click. The suggestion does
// the thinking; the click keeps a human's eyes on an irreversible decision.

// Order matters: the first match wins, so the most specific patterns come
// first. A name mentioning a dupatta ALONGSIDE a garment is a set, not an
// accessory — that is the case a naive "contains dupatta" test gets wrong.
export const BREAKDOWN_SUGGESTIONS = [
  // Explicitly NOT a dupatta, whatever else the name says. First, because it
  // overrides the set-detection below: "...Choga With Salwar - without dupatta"
  // contains both a garment and the word dupatta.
  { key: "top_bottom", re: /\b(with\s*out|no)\s+dupatta\b/i },

  // A garment word AND a dupatta word → a SET, not an accessory. This is the
  // case a naive "contains dupatta" test gets wrong, in either word order.
  { key: "top_bottom_dupatta", re: /\b(kurta|choga|kalidaar|anarkali|suit|set|sharara|gharara|garara|lehenga|salwar|palazzo|pant|churidar|blouse|jacket|skirt)\b[\s\S]*\b(dupatta|odhni|odhani|chunni|scarf|stole)\b/i },
  { key: "top_bottom_dupatta", re: /\b(dupatta|odhni|odhani|chunni|scarf|stole)\b[\s\S]*\b(kurta|choga|kalidaar|anarkali|suit|set|sharara|gharara|garara|lehenga|salwar|palazzo|pant|churidar|blouse|jacket|skirt)\b/i },

  // An accessory sold alone: a dupatta word and NO garment word anywhere.
  { key: "dupatta_only", re: /^(?!.*\b(kurta|choga|kalidaar|anarkali|suit|set|sharara|gharara|garara|lehenga|salwar|palazzo|pant|churidar|blouse|jacket|skirt)\b)[\s\S]*\b(dupatta|odhni|odhani|chunni|scarf|stole)\b/i },

  // Names both a top and a bottom.
  {
    key: "top_bottom",
    re: /\b(kurta|choga|kalidaar|anarkali|blouse|top)\b[\s\S]*\b(salwar|palazzo|pant|churidar|sharara|gharara|garara|skirt|bottom)\b/i,
  },

  // A bag is not a garment: one EX piece named after the product.
  { key: "extras_only", re: /\b(potli|bag|clutch|pouch)\b/i },
];

/**
 * The likely breakdown for a typed line, or null when the name says nothing
 * useful. Null is a normal answer, not a failure — it just means no choice is
 * pre-selected and the person picks unaided.
 */
export const suggestBreakdown = (productName) => {
  const name = String(productName || "");
  if (!name.trim()) return null;
  return BREAKDOWN_SUGGESTIONS.find((s) => s.re.test(name))?.key || null;
};

export const breakdownForItem = (order, index) =>
  (order?.manual_line_breakdown || []).find((b) => b?.item_index === index) || null;

// Which choice an existing override corresponds to, so a set breakdown shows as
// selected rather than blank on reload.
export const matchChoice = (b) =>
  b
    ? BREAKDOWN_CHOICES.find(
      (c) =>
        !!c.value.top === !!b.top &&
        !!c.value.bottom === !!b.bottom &&
        c.value.includes_dupatta === (b.includes_dupatta === true) &&
        (c.value.includes_extra === true) === (b.includes_extra === true),
    )?.key || null
    : null;
