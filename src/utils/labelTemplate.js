import { supabase } from "../lib/supabaseClient";

/**
 * labelTemplate — the shared definition of what a printed barcode slip says.
 *
 * One module owns three things so that a second dashboard needs none of its
 * own: the list of fields a slip may print (LABEL_FIELDS), how to load and save
 * a design (fetchLabelTemplate / saveLabelTemplate), and how to turn a product
 * row into the values those fields resolve to (labelValues).
 *
 * The design itself lives in `label_templates`, keyed by print surface — see
 * db/…/v2/92_label_templates.sql. Today the only surface is "sku" (the tags
 * from the inventory dashboard). Adding the designer to another dashboard is
 * mounting <LabelDesigner surface="…" /> and inserting one row; nothing here
 * gets copied.
 *
 * Storing the design rather than passing it as props is the point: the person
 * who designs the slip and the person who prints it are different people at
 * different machines, and a label roll is physical stock. A per-browser design
 * would quietly print two incompatible batches of stickers.
 */

export const SKU_LABEL_SURFACE = "sku";

/**
 * Fields a slip line can print, in the order they're offered.
 *
 * `get` reads from a `products` row. Keeping the accessor HERE rather than in
 * the PDF is what lets a different surface reuse the same designer with its own
 * row shape later — the PDF only ever sees resolved strings.
 *
 * Deliberately excludes cost/margin columns: a slip is stuck on a garment a
 * customer handles, so anything printable here is customer-safe by
 * construction rather than by remembering not to tick it.
 */
// `caption` is the DEFAULT label printed before the value ("Name: Hafsa"). It
// is a tag caption, not the dropdown wording: "Product name" is the right thing
// to pick from a menu, "Name" is the right thing to print on a 50mm sticker.
// The client can overwrite or clear it per line; clearing prints the value
// alone.
export const LABEL_FIELDS = [
  { field: "sku_id", label: "SKU number", caption: "SKU", get: (p) => p.sku_id },
  {
    field: "name",
    label: "Product name",
    caption: "Name",
    // reserve_sku_rows seeds name = the SKU string itself as a NOT NULL
    // placeholder (74). Printing that gives a tag reading "SKU-1069" twice —
    // once under the bars and once as its "name". A draft has no name yet, so
    // print nothing rather than an echo of the barcode.
    get: (p) => (p.name && p.name !== p.sku_id ? p.name : ""),
  },
  {
    field: "base_price",
    label: "Price",
    caption: "Price",
    // "Rs", NOT the ₹ glyph. @react-pdf's built-in Helvetica is WinAnsi-encoded
    // and has no U+20B9: it silently renders as ¹ (superscript one), so every
    // price on every sticker would read "¹48,500". Verified by rendering.
    //
    // CustomerOrderPdf solves this by registering Noto Sans from a CDN, which is
    // wrong here — that is a network fetch in front of a label print, on a
    // warehouse PC, and a failed fetch would block the sticker. "Rs" is
    // unambiguous on a garment tag and needs no font at all.
    //
    // Whole rupees: couture prices have no paise, and decimals only cost width
    // on a 25mm label.
    // 0 is a PLACEHOLDER, not a price: reserve_sku_rows seeds base_price = 0 on
    // a reserved draft because the column is NOT NULL (74). Printing "Rs 0" on
    // a garment tag advertises it as free, and these tags are stuck on real
    // stock before anyone fills in the details. A genuinely free item is not a
    // thing this business sells, so treating 0 as "not priced yet" is right.
    get: (p) =>
      !p.base_price
        ? ""
        : `Rs ${Number(p.base_price).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
  },
  { field: "default_color", label: "Colour", caption: "Colour", get: (p) => p.default_color },
  { field: "store_category", label: "Category", caption: "Category", get: (p) => p.store_category },
  {
    field: "available_size",
    label: "Sizes",
    caption: "Size",
    // available_size is a text[] — join it, don't let "S,M,L" arrive as the
    // string "[object Object]" via String().
    get: (p) => (Array.isArray(p.available_size) ? p.available_size.join(", ") : p.available_size),
  },
  {
    field: "custom",
    label: "Custom text",
    // The escape hatch: a brand name, a care note, "Made in India". Its text
    // comes from the template line itself, not the product, so `get` is never
    // called for it — the PDF special-cases field === "custom".
    get: () => "",
  },
];

// Mirrors the table's defaults. Used when nothing is saved yet and as the
// shape the designer edits, so a missing row prints exactly what this slip
// printed before templates existed: bars and the SKU, nothing more.
export const DEFAULT_TEMPLATE = {
  width_mm: 50,
  height_mm: 25,
  lines: [],
  show_value: true,
};

// PostgREST reports a table that is absent (or not yet in the schema cache)
// as PGRST205 / 42P01, NOT as an empty result. That is the state of any
// deployment where migration 92 has not run — including every one that existed
// before this feature.
const TABLE_MISSING = (e) =>
  e?.code === "PGRST205" ||
  e?.code === "42P01" ||
  /schema cache|does not exist/i.test(e?.message || "");

/**
 * Load a surface's template.
 *
 * NO TEMPLATE IS NOT AN ERROR. A missing row and a missing TABLE mean the same
 * thing — nobody has customised this slip — and both yield DEFAULT_TEMPLATE,
 * which is byte-for-byte the slip this app printed before templates existed.
 *
 * This is load-bearing: printing barcodes is an EXISTING feature that worked
 * before migration 92 and must keep working without it. Throwing here made a
 * brand-new table a hard dependency of re-print and broke it outright
 * ('Could not find the table public.label_templates in the schema cache').
 * A new feature must never take a working one down with it.
 *
 * Genuine read failures (network, RLS, a malformed response) still THROW:
 * those mean a design may exist that we could not read, and silently printing
 * a different one across a roll of stickers is expensive and physical.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.required]  true = the caller is EDITING the design,
 *        so an absent table is fatal and must be surfaced. The designer passes
 *        this; printing never does.
 */
export async function fetchLabelTemplate(surface = SKU_LABEL_SURFACE, opts = {}) {
  const { data, error } = await supabase
    .from("label_templates")
    .select("key, width_mm, height_mm, lines, show_value")
    .eq("key", surface)
    .maybeSingle();

  if (error) {
    if (TABLE_MISSING(error) && !opts.required) {
      return { ...DEFAULT_TEMPLATE, key: surface, missing: true };
    }
    throw error;
  }
  if (!data) return { ...DEFAULT_TEMPLATE, key: surface };

  return {
    ...data,
    width_mm: Number(data.width_mm),
    height_mm: Number(data.height_mm),
    lines: Array.isArray(data.lines) ? data.lines : [],
  };
}

/** Save a design. Throws on failure — the designer surfaces it in a popup. */
export async function saveLabelTemplate(surface, template, by) {
  const { error } = await supabase
    .from("label_templates")
    .update({
      width_mm: template.width_mm,
      height_mm: template.height_mm,
      lines: template.lines || [],
      show_value: template.show_value !== false,
      updated_at: new Date().toISOString(),
      updated_by: by || null,
    })
    .eq("key", surface);

  if (error) throw error;

  // RLS returns success with zero rows touched when the policy refuses the
  // write, which would otherwise look like a save and silently print the old
  // design. Confirm the row actually moved.
  //
  // required: without it a missing table would resolve to DEFAULT_TEMPLATE and,
  // for a design that happens to be empty, compare EQUAL — reporting a save
  // that never happened.
  const saved = await fetchLabelTemplate(surface, { required: true });
  if (JSON.stringify(saved.lines) !== JSON.stringify(template.lines || [])) {
    throw new Error(
      "The design was not saved — your role may not have permission to edit label templates."
    );
  }
  return saved;
}

/**
 * Resolve a template's fields against one product row.
 *
 * Returns only what the template asks for, so a slip that prints nothing but
 * bars costs no product lookup at all (see labelProductsBySku).
 */
export function labelValues(product, template) {
  const out = {};
  for (const line of template?.lines || []) {
    const def = LABEL_FIELDS.find((f) => f.field === line.field);
    if (!def || line.field === "custom") continue;
    const v = def.get(product || {});
    if (v != null && v !== "") out[line.field] = String(v);
  }
  return out;
}

/**
 * Fetch the product rows a batch of SKUs needs, keyed by sku_id.
 *
 * Skipped entirely when the template prints no product field — the common case
 * and the one that must stay instant, since it runs while someone waits to
 * print. Reads base `products`, not products_live: a freshly reserved SKU is
 * still is_draft and the view would hide the very rows being printed.
 */
export async function labelProductsBySku(skus, template) {
  const needsProduct = (template?.lines || []).some(
    (l) => l.field && l.field !== "custom"
  );
  if (!needsProduct || !skus?.length) return {};

  const { data, error } = await supabase
    .from("products")
    .select("sku_id, name, base_price, default_color, store_category, available_size")
    .in("sku_id", skus);

  if (error) throw error;
  return Object.fromEntries((data || []).map((p) => [p.sku_id, p]));
}
