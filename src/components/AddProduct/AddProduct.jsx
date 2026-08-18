import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import { usePopup } from "../Popup";
import {
  CSV_COLUMNS,
  TEMPLATE_DEMO_ROWS,
  buildCsv,
  downloadCsv,
  parseCsv,
  validateRow,
} from "./csvHelpers";
import { STORE_CATEGORIES, DEFAULT_STORE_CATEGORY } from "../../utils/storeCategory";
import { fetchShopifyInventory, adjustShopifyInventory } from "../../utils/shopifyInventory";
import useSkuScan from "../../hooks/useSkuScan";
import BarcodeExportPanel from "./BarcodeExportPanel";
import SkuTypeChooser from "./SkuTypeChooser";
import ScannedProductCard from "./ScannedProductCard";
import "./AddProduct.css";

// Standard size order for sorting variant rows + the size multi-select.
const SIZE_OPTIONS = [
  "XXS", "XS", "S", "M", "L", "XL", "XXL",
  "2XL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL",
];

/**
 * Generate the next SKU based on the current max in the database.
 * Format: SKU-#### (4-digit zero-padded). If a unique-violation happens
 * on insert (race), the caller bumps and retries once.
 */
const fetchNextSku = async () => {
  // Pull all SKUs matching the SKU-NNNN pattern, find the max, +1.
  // Done in JS because Supabase JS client doesn't expose RAW expressions.
  // Paged past Supabase's 1000-row cap — a capped scan under-counts the max
  // and would mint DUPLICATE SKUs once products exceed 1000 (they do).
  //
  // MUST read `products`, NOT `products_live`. Reserved-but-unfilled rows
  // (name IS NULL, minted by reserve_sku_rows for pre-printed barcodes) are
  // exactly the rows holding already-printed numbers. Hiding them here mints a
  // SKU that a physical sticker already carries — and since the 23505 retry
  // re-runs this same scan, it returns the same colliding number and the insert
  // fails permanently. See db/…/v2/74_reserve_sku_rows.sql.
  const { data, error } = await fetchAllRows("products", (q) => q
    .select("sku_id")
    .like("sku_id", "SKU-%"));
  if (error) throw error;
  let max = 0;
  (data || []).forEach((r) => {
    const m = (r.sku_id || "").match(/^SKU-(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  const next = max + 1;
  return `SKU-${String(next).padStart(4, "0")}`;
};

// ─── ChipInput ───────────────────────────────────────────────────────
// Autocomplete chip field. Suggestions dropdown shows existing values
// from the DB (passed via `suggestions`). User can type a brand-new
// value and press Enter to add it.
function ChipInput({ value, onChange, suggestions = [], placeholder = "Type and press Enter…" }) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const addChip = (raw) => {
    const v = (raw || "").trim();
    if (!v) return;
    if ((value || []).some((x) => x.toLowerCase() === v.toLowerCase())) return;
    onChange([...(value || []), v]);
    setInput("");
  };

  const removeChip = (i) => {
    const next = [...(value || [])];
    next.splice(i, 1);
    onChange(next);
  };

  const filtered = useMemo(() => {
    const q = input.trim().toLowerCase();
    const taken = new Set((value || []).map((v) => v.toLowerCase()));
    return suggestions
      .filter((s) => !taken.has(s.toLowerCase()) && (!q || s.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [input, suggestions, value]);

  return (
    <div className="ap-chip-wrap" ref={wrapRef}>
      <div className="ap-chip-row" onClick={() => setOpen(true)}>
        {(value || []).map((v, i) => (
          <span key={i} className="ap-chip">
            {v}
            <button type="button" onClick={() => removeChip(i)} aria-label="remove">×</button>
          </span>
        ))}
        <input
          className="ap-chip-input"
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); addChip(input); }
            if (e.key === "Backspace" && !input && (value || []).length > 0) {
              removeChip((value || []).length - 1);
            }
          }}
          placeholder={(value || []).length === 0 ? placeholder : ""}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="ap-chip-suggest">
          {filtered.map((s) => (
            <button type="button" key={s} className="ap-chip-suggest-item" onClick={() => addChip(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── AddProduct (main reusable component) ────────────────────────────
export default function AddProduct({ onProductAdded, prefill, onPrefillConsumed }) {
  const { showPopup, PopupComponent } = usePopup();

  // Mode toggles
  const [mode, setMode] = useState("manual");           // 'manual' | 'csv' | 'barcodes'
  // 'normal' = regular off-the-rack | 'lxrts' = Shopify-synced | 'custom_piece' = bespoke / made-to-order.
  // LXRTS and Custom Piece are mutually exclusive product types — a single product
  // can never be both. Custom Piece persists `is_custom_piece: true` on the row;
  // Normal-shaped layout (sizes + inventory) applies to both 'normal' and 'custom_piece'.
  const [productType, setProductType] = useState("normal");

  // Auto-SKU
  const [sku, setSku] = useState("");
  const [skuLoading, setSkuLoading] = useState(true);

  // ─── What this form is doing right now ───
  // 'create'  → INSERT a brand-new product, SKU auto-generated (the default).
  // 'fillTag' → UPDATE a reserved row behind a scanned pre-printed barcode.
  //             SKU is locked: it is printed on a garment.
  // 'edit'    → UPDATE an already-live product. SKU locked for the same reason.
  //
  // Kept as an explicit mode rather than inferred from `editTarget` because the
  // two UPDATE paths differ in more than the row: fillTag guards on is_draft,
  // edit must NOT (a live product isn't a draft, so that filter would match
  // zero rows and every edit would look like a lost race).
  const [formMode, setFormMode] = useState("create");
  // The `products` row being updated — set for both 'fillTag' and 'edit'.
  const [editTarget, setEditTarget] = useState(null);
  // Variant ids present when an LXRTS product was loaded, so save can tell an
  // edited row from a new one and spot the ones that were removed.
  const [loadedVariantIds, setLoadedVariantIds] = useState([]);

  const [scanning, setScanning] = useState(false);            // scanner armed?
  const [typeChooser, setTypeChooser] = useState(null);       // { sku, row } awaiting a type pick
  const [scannedProduct, setScannedProduct] = useState(null); // already-filled -> details card

  // Common form fields
  // Extras are stored in a separate `extras` table and are uniform across all
  // products, so we don't capture them here (no extra_options, default_extra,
  // or extra_price fields on this form).
  const [name, setName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [topOptions, setTopOptions] = useState([]);
  const [bottomOptions, setBottomOptions] = useState([]);
  const [defaultTop, setDefaultTop] = useState("");
  const [defaultBottom, setDefaultBottom] = useState("");
  const [defaultColor, setDefaultColor] = useState("");
  // Store category — which retail store(s) this product belongs to.
  // "All Stores" = visible everywhere; "Delhi"/"Ludhiana" = location-specific.
  const [storeCategory, setStoreCategory] = useState(DEFAULT_STORE_CATEGORY);
  // Whether this product is sold with a dupatta. Applies to all three product
  // types. When true, orders for this product generate a separate dupatta
  // component + barcode (the order form pre-fills a per-item toggle from this).
  const [hasDupatta, setHasDupatta] = useState(false);
  // Default dupatta colour. Its own list (`dupatta_colors` table) — deliberately
  // separate from the `colors` table, since dupattas are often a contrast piece.
  // Pre-fills the order form's Dupatta Color dropdown, so the name must match a
  // row in that table exactly. Blank falls back to Default Color on save.
  const [defaultDupattaColor, setDefaultDupattaColor] = useState("");

  // Normal-only
  const [availableSizes, setAvailableSizes] = useState([]);
  const [inventory, setInventory] = useState("0");
  const [isMto, setIsMto] = useState(false);

  // LXRTS-only
  const [shopifyProductId, setShopifyProductId] = useState("");
  // Each variant: { size, price, inventory, shopify_variant_id }
  const [variants, setVariants] = useState([{ size: "", price: "", inventory: "0", shopify_variant_id: "" }]);

  // ─── CSV mode state ───
  const [csvFileName, setCsvFileName] = useState("");
  const [csvParsed, setCsvParsed] = useState(null);   // { headers, data }
  const [csvValidation, setCsvValidation] = useState(null); // { results: [{ ok, normalized?, errors? }], errorCount }
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvProgress, setCsvProgress] = useState({ done: 0, total: 0, succeeded: 0, failed: 0 });
  const [csvExporting, setCsvExporting] = useState(false);
  const csvFileInputRef = useRef(null);

  // Suggestions for chip inputs (top/bottom), pulled once on mount
  const [topSuggest, setTopSuggest] = useState([]);
  const [bottomSuggest, setBottomSuggest] = useState([]);
  // Full color rows from the `colors` table. Default Color must be an exact
  // match of a row in this table so ProductForm can find its hex and
  // pre-fill swatches when the product is later selected.
  const [colorList, setColorList] = useState([]);
  // Names from the `dupatta_colors` table — the canonical dupatta colour list,
  // used for the manual dropdown and to validate the CSV column.
  const [dupattaColorList, setDupattaColorList] = useState([]);

  const [submitting, setSubmitting] = useState(false);

  // ─── Initial data load ───
  useEffect(() => {
    let alive = true;
    (async () => {
      setSkuLoading(true);
      try {
        const next = await fetchNextSku();
        if (alive) setSku(next);
      } catch (e) {
        console.error("SKU fetch error:", e);
      } finally {
        if (alive) setSkuLoading(false);
      }

      // Pull existing top/bottom options used across products — these stay
      // as freeform chip suggestions since every product can have its own
      // bespoke list. We unnest client-side (Supabase JS doesn't expose it).
      // Paged past Supabase's 1000-row cap
      const { data: prodData } = await fetchAllRows("products", (q) => q
        .select("top_options, bottom_options"));
      if (!alive) return;
      const t = new Set(), b = new Set();
      (prodData || []).forEach((p) => {
        (p.top_options || []).forEach((v) => v && t.add(String(v).trim()));
        (p.bottom_options || []).forEach((v) => v && b.add(String(v).trim()));
      });
      setTopSuggest([...t].sort());
      setBottomSuggest([...b].sort());

      // Colors must be a curated list (from the `colors` table) so
      // ProductForm's exact-name match against the same table succeeds.
      const { data: colorData } = await supabase
        .from("colors")
        .select("name, hex")
        .order("name", { ascending: true });
      if (!alive) return;
      setColorList(colorData || []);

      const { data: dupColorData } = await supabase
        .from("dupatta_colors")
        .select("name")
        .order("name", { ascending: true });
      if (!alive) return;
      setDupattaColorList((dupColorData || []).map((d) => d.name).filter(Boolean));
    })();
    return () => { alive = false; };
  }, []);

  const refreshSku = async () => {
    setSkuLoading(true);
    try {
      const next = await fetchNextSku();
      setSku(next);
    } catch (e) {
      console.error(e);
    } finally {
      setSkuLoading(false);
    }
  };

  const resetForm = () => {
    setName(""); setImageUrl(""); setBasePrice("");
    setTopOptions([]); setBottomOptions([]);
    setDefaultTop(""); setDefaultBottom(""); setDefaultColor("");
    setStoreCategory(DEFAULT_STORE_CATEGORY);
    setHasDupatta(false);
    setDefaultDupattaColor("");
    setAvailableSizes([]); setInventory("0"); setIsMto(false);
    setShopifyProductId("");
    setVariants([{ size: "", price: "", inventory: "0", shopify_variant_id: "" }]);
    setLoadedVariantIds([]);
    // Drop the scanned tag / edited product and go back to auto-SKU. This must
    // happen after a successful fill: that garment is catalogued now, so keeping
    // its SKU locked would make the very next save collide on the unique key.
    setEditTarget(null);
    setFormMode("create");
    refreshSku();
  };

  // ─── Load an existing product back into the form ───
  // The inverse of the productRow assembly in handleSubmit. Two callers:
  //
  //   mode 'edit'      → update that same row. SKU comes from the product and
  //                      is locked; a live SKU may already be printed on a tag.
  //   mode 'duplicate' → copy the details onto a FRESH SKU. Deliberately leaves
  //                      formMode at 'create', so the existing insert branch
  //                      (with its 23505 retry) handles the save unchanged and
  //                      nothing is written until the user hits Save.
  const loadProductIntoForm = async (product, { mode }) => {
    if (!product) return;
    const isEdit = mode === "edit";

    // Derive the type toggle from the flags — the same mapping handleSubmit
    // writes, read backwards.
    const type = product.sync_enabled
      ? "lxrts"
      : product.is_custom_piece
        ? "custom_piece"
        : "normal";
    setProductType(type);

    // basePrice/inventory back controlled number inputs and are string state:
    // a null here would make React flip the input to uncontrolled mid-edit.
    setName(product.name || "");
    setImageUrl(product.image_url || "");
    setBasePrice(product.base_price != null ? String(product.base_price) : "");
    setTopOptions(product.top_options || []);
    setBottomOptions(product.bottom_options || []);
    setDefaultTop(product.default_top || "");
    setDefaultBottom(product.default_bottom || "");
    setDefaultColor(product.default_color || "");
    setStoreCategory(product.store_category || DEFAULT_STORE_CATEGORY);
    setHasDupatta(!!product.has_dupatta);
    setDefaultDupattaColor(product.default_dupatta_color || "");
    setAvailableSizes(product.available_size || []);

    // 9999 is the made-to-order sentinel, not a real count.
    const mto = product.inventory === 9999;
    setIsMto(mto);
    setInventory(mto ? "0" : String(product.inventory ?? 0));

    setShopifyProductId(product.shopify_product_id || "");

    // LXRTS keeps per-size data in its own table, so the variant grid needs a
    // second read. Only for LXRTS: a normal product has no variant rows.
    if (type === "lxrts") {
      const { data: vars, error: varErr } = await supabase
        .from("product_variants")
        .select("id, size, price, inventory, shopify_variant_id")
        .eq("product_id", product.id);

      if (varErr) {
        console.error("Variant load failed:", varErr);
        showPopup({
          type: "error",
          title: "Could Not Load Sizes",
          message: `${product.sku_id}'s size variants couldn't be loaded, so saving now would wipe them. Close this and try again. (${varErr.message})`,
          confirmText: "OK",
        });
        return;
      }

      const rows = (vars || [])
        .slice()
        .sort((a, b) => SIZE_OPTIONS.indexOf(a.size) - SIZE_OPTIONS.indexOf(b.size))
        .map((v) => ({
          // Duplicating drops the id so every row inserts fresh against the new
          // product. Keeping it would make the save diff update the ORIGINAL
          // product's variants instead.
          id: isEdit ? v.id : undefined,
          size: v.size || "",
          price: v.price != null ? String(v.price) : "",
          inventory: String(v.inventory ?? 0),
          shopify_variant_id: v.shopify_variant_id || "",
        }));

      setVariants(rows.length > 0
        ? rows
        : [{ size: "", price: "", inventory: "0", shopify_variant_id: "" }]);
      setLoadedVariantIds(isEdit ? rows.map((r) => r.id).filter(Boolean) : []);
    } else {
      setVariants([{ size: "", price: "", inventory: "0", shopify_variant_id: "" }]);
      setLoadedVariantIds([]);
    }

    // Anything the form was showing about a scan is stale now.
    setTypeChooser(null);
    setScannedProduct(null);
    setScanning(false);
    setMode("manual");

    if (isEdit) {
      setEditTarget(product);
      setFormMode("edit");
      setSku(product.sku_id || "");
      setSkuLoading(false);
    } else {
      setEditTarget(null);
      setFormMode("create");
      refreshSku();   // a copy is a new garment and needs its own number
    }
  };

  // A prefill handed down by the parent (Duplicate/Edit from the catalogue).
  // Consumed immediately: without that, hitting Reset and coming back to this
  // tab would silently re-apply the same product over the cleared form.
  useEffect(() => {
    if (!prefill?.product) return;
    loadProductIntoForm(prefill.product, { mode: prefill.mode || "duplicate" });
    onPrefillConsumed?.();
    // loadProductIntoForm is recreated every render (it closes over ~20
    // setters, all stable); depending on it would re-run this on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  // ─── Scanned pre-printed barcode ───
  // Three outcomes: a reserved row (fill it in), an already-filled product
  // (show it), or a code we never issued (say so plainly rather than silently
  // opening a blank form, which would invent a product for a stray barcode).
  const handleScanResult = useCallback((result) => {
    switch (result.type) {
      case "reserved":
        setScannedProduct(null);
        setTypeChooser({ sku: result.sku, row: result.row });
        break;

      case "filled":
        setTypeChooser(null);
        setScannedProduct(result.product);
        break;

      case "unknown":
        showPopup({
          type: "warning",
          title: "Unrecognised Barcode",
          message: `${result.sku} isn't one of our reserved barcodes. Use "Export Barcodes" to print tags — only those can be filled in by scanning.`,
          confirmText: "OK",
        });
        break;

      case "error":
        // Never fall through to the create flow on a failed lookup: the SKU may
        // well exist, and creating it again would duplicate a live product.
        console.error("SKU lookup failed:", result.error);
        showPopup({
          type: "error",
          title: "Lookup Failed",
          message: `Couldn't check ${result.sku}. Check your connection and scan again.`,
          confirmText: "OK",
        });
        break;

      default:
        // A production barcode (…-TOP / a master order no) — not ours to handle.
        break;
    }
    // showPopup only ever calls setState; excluded from deps so the scanner's
    // document listener doesn't rebind on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Armed only while Scan Code is active on the manual form. The listener is
  // document-level, so leaving it on elsewhere would swallow keystrokes.
  const { resolving: scanResolving } = useSkuScan({
    enabled: scanning && mode === "manual",
    onResult: handleScanResult,
  });

  // Picking a type moves the reserved row into the form. The SKU is now fixed:
  // it is printed on a physical garment, so it cannot be re-rolled.
  const startFillingScanned = (chosenType) => {
    if (!typeChooser) return;
    setProductType(chosenType);
    setEditTarget(typeChooser.row);
    setFormMode("fillTag");
    setSku(typeChooser.sku);
    setSkuLoading(false);
    setTypeChooser(null);
    setScannedProduct(null);
  };

  // Back out of a scan or an edit: clears the form and returns to auto-SKU.
  const cancelScannedFill = () => {
    setTypeChooser(null);
    setScannedProduct(null);
    resetForm();
  };

  // ─── Validation ───
  // Custom Piece uses the same shape as Normal — sizes + inventory.
  // LXRTS still needs Shopify ID + variants.
  const validate = () => {
    if (!name.trim()) return "Product name is required.";
    if (!basePrice || Number(basePrice) <= 0) return "Base price must be greater than 0.";

    if (productType === "normal" || productType === "custom_piece") {
      if (!isMto && availableSizes.length === 0) return "Pick at least one available size, or mark as Made-to-Order.";
      if (!isMto && (inventory === "" || isNaN(Number(inventory)))) return "Inventory must be a number.";
    } else if (productType === "lxrts") {
      if (!shopifyProductId.trim()) return "Shopify Product ID is required for LXRTS products.";
      const validVariants = variants.filter((v) => v.size && v.size.trim());
      if (validVariants.length === 0) return "Add at least one size variant.";
      const sizeSet = new Set();
      for (const v of validVariants) {
        const k = v.size.trim().toUpperCase();
        if (sizeSet.has(k)) return `Duplicate size in variants: ${v.size}.`;
        sizeSet.add(k);
      }
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    const err = validate();
    if (err) {
      showPopup({ type: "warning", title: "Missing Information", message: err, confirmText: "OK" });
      return;
    }
    setSubmitting(true);

    // Common product row.
    // Note: extra_options / default_extra / extra_price are intentionally
    // omitted — extras are managed via the global `extras` table and apply
    // uniformly to every product.
    const productRow = {
      sku_id: sku,
      name: name.trim(),
      image_url: imageUrl.trim() || null,
      base_price: Number(basePrice),
      top_options: topOptions.length > 0 ? topOptions : null,
      bottom_options: bottomOptions.length > 0 ? bottomOptions : null,
      default_top: defaultTop || null,
      default_bottom: defaultBottom || null,
      default_color: defaultColor.trim() || null,
      store_category: storeCategory || DEFAULT_STORE_CATEGORY,
      has_dupatta: hasDupatta,
      // Only meaningful with a dupatta. Blank falls back to the product's own
      // default colour — same rule the bulk SQL import used — so the order form
      // always has something to pre-fill instead of an empty dropdown.
      default_dupatta_color: hasDupatta
        ? (defaultDupattaColor.trim() || defaultColor.trim() || null)
        : null,
      sync_enabled: productType === "lxrts",
      is_custom_piece: productType === "custom_piece",
      // Always a real product by the time it is saved. On the scanned-tag path
      // this is what LIFTS the reservation: without it the row would keep
      // is_draft = true and stay invisible behind products_live — saved, but
      // missing from the order form and every dashboard.
      is_draft: false,
    };

    if (productType === "normal" || productType === "custom_piece") {
      productRow.available_size = availableSizes.length > 0 ? availableSizes : null;
      productRow.inventory = isMto ? 9999 : Number(inventory) || 0;
      productRow.shopify_product_id = null;
    } else {
      // LXRTS: per-size info lives in product_variants. Set inventory=0 on
      // the row (the dashboard sums variant inventory for the display).
      productRow.shopify_product_id = shopifyProductId.trim();
      productRow.inventory = 0;
      productRow.available_size = null;
    }

    let inserted = null;
    let lastError = null;

    if (formMode === "fillTag" || formMode === "edit") {
      // The row already exists, so this is an UPDATE. Inserting would create a
      // second row for one physical barcode.
      //
      // No SKU-bump retry on either path, deliberately. A scanned or already-
      // catalogued SKU is a physical fact printed on a garment; quietly moving
      // the product to a different number would leave a sticker that lies about
      // what it is attached to.
      let q = supabase
        .from("products")
        .update(productRow)
        .eq("id", editTarget.id);

      // Only the fill path guards on is_draft — it is what catches a tag that
      // someone else filled in while this form was open. An edit targets a live
      // product, which is by definition NOT a draft, so the same filter there
      // would match zero rows and make every successful edit report a lost race.
      if (formMode === "fillTag") q = q.eq("is_draft", true);

      const { data, error } = await q.select().maybeSingle();

      if (error) {
        lastError = error;
      } else if (!data) {
        lastError = new Error(
          formMode === "fillTag"
            ? `${sku} was filled in by someone else while this form was open. Re-scan the tag to see the current product.`
            : `${sku} could not be found — it may have been removed while this form was open.`
        );
      } else {
        inserted = data;
      }
    } else {
      // Insert with one retry if SKU race-collides.
      let attempt = 0;
      while (attempt < 2 && !inserted) {
        const { data, error } = await supabase
          .from("products")
          .insert(productRow)
          .select()
          .single();
        if (!error) { inserted = data; break; }
        lastError = error;
        // PG unique violation = 23505. PostgREST surfaces code "23505" or message includes 'duplicate'.
        const isDup = error.code === "23505" || /duplicate|unique/i.test(error.message || "");
        if (!isDup) break;
        // Bump SKU and retry once
        try {
          const fresh = await fetchNextSku();
          productRow.sku_id = fresh;
          setSku(fresh);
        } catch { break; }
        attempt += 1;
      }
    }

    if (!inserted) {
      console.error("Save failed:", lastError);
      showPopup({
        type: "error",
        title: formMode === "create" ? "Insert Failed" : "Could Not Save",
        message: lastError?.message || "Could not save product.",
        confirmText: "OK",
      });
      setSubmitting(false);
      return;
    }

    // Advisory notes appended to the success popup — the save worked, but
    // something about the Shopify stock reconciliation is worth knowing.
    const stockNotes = [];

    // For LXRTS, write the variant rows.
    if (productType === "lxrts") {
      const filled = variants.filter((v) => v.size && v.size.trim());
      const toRow = (v) => ({
        product_id: inserted.id,
        size: v.size.trim().toUpperCase(),
        price: v.price ? Number(v.price) : Number(basePrice),
        inventory: Number(v.inventory) || 0,
        shopify_variant_id: v.shopify_variant_id?.trim() || null,
      });

      let varErr = null;

      // Shopify holds the real stock for an LXRTS product — the SA order form
      // reads its sizes straight from there (ProductForm.js), and the Inventory
      // tab overwrites product_variants to match on every load. So this form
      // reconciles rather than asserts: read Shopify once, up front.
      //
      // Read as late as possible: the edit path below turns these numbers into
      // deltas, and a sale between the read and the push lands Shopify on the
      // wrong figure.
      const shopifyQty = await fetchShopifyInventory(inserted.id);
      // null = Shopify unreachable. Never read as "no stock" — that would zero
      // a live catalogue. Keep the typed numbers and say they're unverified.
      const shopifyDown = shopifyQty === null;
      // Sizes Shopify doesn't know: a name mismatch ("Small" vs "S"), or a size
      // that genuinely isn't on the store. Nothing here can create a Shopify
      // variant (the edge fn has no such action), so these are reported, not
      // fixed — silence is what lets them drift from Shopify forever.
      const unsyncedSizes = [];
      const syncFailures = [];

      if (formMode === "edit") {
        // Editing: diff against what was loaded. A blind insert here would add a
        // second row for every size the product already had.
        const kept = filled.filter((v) => v.id);
        const added = filled.filter((v) => !v.id);
        const keptIds = new Set(kept.map((v) => v.id));
        const removedIds = loadedVariantIds.filter((id) => !keptIds.has(id));

        for (const v of kept) {
          const row = toRow(v);
          const live = shopifyDown ? undefined : shopifyQty[row.size];

          // Push the stock change to Shopify. Computed against Shopify's CURRENT
          // number rather than the one this form loaded: "reduce" is a relative
          // delta, so diffing against a stale value moves the store's count to
          // the wrong place. Positive reduces, negative increases.
          if (live === undefined) {
            if (!shopifyDown) unsyncedSizes.push(row.size);
          } else if (live !== row.inventory) {
            const res = await adjustShopifyInventory(
              inserted.id, row.size, live - row.inventory
            );
            if (!res.ok) syncFailures.push(`${row.size}: ${res.error}`);
          }

          const { error } = await supabase
            .from("product_variants")
            .update(row)
            .eq("id", v.id);
          if (error) { varErr = error; break; }
        }

        if (!varErr && added.length > 0) {
          // A size added here has no Shopify variant to adjust — pushing a delta
          // would move some OTHER size's stock or fail outright. Treat it exactly
          // like the create path: take Shopify's number if the size exists there,
          // otherwise keep what was typed and flag it as non-syncing.
          const rows = added.map((v) => {
            const row = toRow(v);
            const live = shopifyDown ? undefined : shopifyQty[row.size];
            if (live === undefined) {
              if (!shopifyDown) unsyncedSizes.push(row.size);
            } else {
              row.inventory = live;
            }
            return row;
          });
          const { error } = await supabase.from("product_variants").insert(rows);
          if (error) varErr = error;
        }

        // Removing a size drops OUR row only. The Shopify variant belongs to the
        // store; deleting it here is not this form's call.
        if (!varErr && removedIds.length > 0) {
          const { error } = await supabase
            .from("product_variants")
            .delete()
            .in("id", removedIds);
          if (error) varErr = error;
        }

        if (varErr) {
          // NO ROLLBACK on an edit. The create/fill rollback below deletes or
          // re-drafts the product — on a live catalogue row that would hide a
          // real product from every dashboard over a variant error. The product
          // update stands; report what didn't land and let the user retry.
          console.error("Variant save failed:", varErr);
          showPopup({
            type: "warning",
            title: "Sizes Not Fully Saved",
            message: `${inserted.name} was updated, but its size variants were not: ${varErr.message}\n\nRe-open the product and check the sizes.`,
            confirmText: "OK",
          });
          if (onProductAdded) onProductAdded(inserted);
          setSubmitting(false);
          return;
        }
      } else {
        // Creating: the product already exists on Shopify with real stock, so we
        // PULL rather than push. Pushing the typed number would ADD to what is
        // already there ("reduce" is relative, there is no absolute set) — type 4
        // against a Shopify 4 and the store would read 8.
        const rows = filled.map((v) => {
          const row = toRow(v);
          const live = shopifyDown ? undefined : shopifyQty[row.size];
          if (live === undefined) {
            if (!shopifyDown) unsyncedSizes.push(row.size);
          } else {
            row.inventory = live;   // Shopify wins
          }
          return row;
        });
        const { error } = await supabase.from("product_variants").insert(rows);
        varErr = error;
      }

      // Stock notes are advisory: the product saved fine, only its numbers are
      // provisional. Collected and shown once rather than one popup per size.
      if (!varErr) {
        if (shopifyDown) {
          stockNotes.push(
            "Shopify couldn't be reached, so the stock figures above are unverified and were not synced. They'll be corrected the next time the Inventory tab loads."
          );
        }
        if (unsyncedSizes.length > 0) {
          stockNotes.push(
            `These sizes aren't on Shopify, so their stock won't sync: ${[...new Set(unsyncedSizes)].join(", ")}. Check the size names match the Shopify variants exactly.`
          );
        }
        if (syncFailures.length > 0) {
          stockNotes.push(
            `Saved here, but Shopify wasn't updated for: ${syncFailures.join("; ")}. Those sizes will revert on the next sync.`
          );
        }
      }

      if (varErr) {
        // Roll back so the form can be retried cleanly.
        if (formMode === "fillTag") {
          // A pre-printed tag: put the row back to reserved rather than
          // deleting it. Deleting would destroy a reservation whose barcode is
          // already stuck on a garment — the SKU would then read as unknown on
          // the next scan and, worse, be re-mintable to a different product.
          // Restoring is_draft is enough: that is what marks a row reserved,
          // and the stale field values are overwritten on the next attempt.
          await supabase
            .from("products")
            .update({ is_draft: true })
            .eq("id", inserted.id);
        } else {
          await supabase.from("products").delete().eq("id", inserted.id);
        }
        console.error("Variants insert failed:", varErr);
        showPopup({
          type: "error",
          title: "Variants Failed",
          message: formMode === "fillTag"
            ? `Nothing was saved — ${sku} is still reserved and can be scanned again. Variant error: ${varErr.message}`
            : `Product was rolled back. Variant error: ${varErr.message}`,
          confirmText: "OK",
        });
        setSubmitting(false);
        return;
      }
    }

    const wasEdit = formMode === "edit";
    const baseMessage = formMode === "fillTag"
      ? `${inserted.name} is now linked to ${inserted.sku_id}. That tag will show these details from now on.`
      : wasEdit
        ? `${inserted.name} (${inserted.sku_id}) updated successfully.`
        : `${inserted.name} (${inserted.sku_id}) saved successfully.`;

    // A stock note downgrades this to a warning: the product saved, but its
    // Shopify figures need attention and shouldn't read as a clean success.
    showPopup({
      type: stockNotes.length > 0 ? "warning" : "success",
      title: formMode === "fillTag"
        ? "Barcode Filled In"
        : wasEdit ? "Product Updated" : "Product Added",
      message: stockNotes.length > 0
        ? `${baseMessage}\n\n${stockNotes.join("\n\n")}`
        : baseMessage,
      confirmText: "OK",
    });
    if (onProductAdded) onProductAdded(inserted);
    // An edit keeps the product on screen — clearing the form the instant it
    // saves reads as "the edit vanished". The user leaves via Done / Reset.
    // Refresh editTarget so a second save in the same session diffs against
    // what is now in the database.
    if (wasEdit) {
      // Re-load rather than patch state by hand: rows just inserted have no id
      // yet, and saving twice in one sitting would insert them all over again.
      await loadProductIntoForm(inserted, { mode: "edit" });
    } else {
      resetForm();
    }
    setSubmitting(false);
  };

  // ─── Variant table helpers (LXRTS) ───
  const updateVariant = (i, key, val) => {
    setVariants((prev) => prev.map((v, idx) => idx === i ? { ...v, [key]: val } : v));
  };
  const addVariantRow = () => setVariants((prev) => [...prev, { size: "", price: "", inventory: "0", shopify_variant_id: "" }]);
  const removeVariantRow = (i) => setVariants((prev) => prev.filter((_, idx) => idx !== i));

  // ─── CSV: download template ───
  const handleDownloadTemplate = () => {
    const csv = buildCsv(CSV_COLUMNS, TEMPLATE_DEMO_ROWS);
    downloadCsv("products-template.csv", csv);
  };

  // ─── CSV: export all NORMAL products ───
  // LXRTS products are excluded — they live across two tables (products +
  // product_variants) with Shopify-specific data and aren't round-trippable
  // through this CSV format.
  const handleExportAll = async () => {
    setCsvExporting(true);
    try {
      // Paged past Supabase's 1000-row cap.
      // products_live: this export is for editing real products, so reserved-
      // but-unfilled barcode rows (name IS NULL) would just be blank lines.
      // Those get filled in by scanning the tag, not via CSV.
      const { data: prods, error: pErr } = await fetchAllRows("products_live", (q) => q
        .select("*")
        .eq("sync_enabled", false)
        .order("sku_id", { ascending: true }));
      if (pErr) throw pErr;

      const rows = (prods || []).map((p) => {
        const inv = p.inventory === 9999 ? "MTO" : (p.inventory ?? 0);
        return {
          sku_id: p.sku_id || "",
          name: p.name || "",
          image_url: p.image_url || "",
          base_price: p.base_price ?? p.price ?? "",
          top_options: (p.top_options || []).join("|"),
          bottom_options: (p.bottom_options || []).join("|"),
          default_top: p.default_top || "",
          default_bottom: p.default_bottom || "",
          default_color: p.default_color || "",
          store_category: p.store_category || DEFAULT_STORE_CATEGORY,
          has_dupatta: p.has_dupatta ? "yes" : "no",
          default_dupatta_color: p.default_dupatta_color || "",
          is_custom_piece: p.is_custom_piece ? "yes" : "no",
          available_size: (p.available_size || []).join("|"),
          inventory: inv,
        };
      });

      const csv = buildCsv(CSV_COLUMNS, rows);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`products-export-${stamp}.csv`, csv);
    } catch (e) {
      console.error("Export failed:", e);
      showPopup({ type: "error", title: "Export Failed", message: e.message || String(e), confirmText: "OK" });
    } finally {
      setCsvExporting(false);
    }
  };

  // ─── CSV: file picked → parse + validate ───
  const handleCsvFile = async (file) => {
    if (!file) return;
    setCsvFileName(file.name);
    setCsvProgress({ done: 0, total: 0, succeeded: 0, failed: 0 });
    try {
      const text = await file.text();
      const parsed = parseCsv(text);

      // Required column check
      const missing = CSV_COLUMNS.filter((c) => !parsed.headers.includes(c));
      if (missing.length > 0) {
        showPopup({
          type: "error",
          title: "Missing Columns",
          message: `Template is missing these columns: ${missing.join(", ")}. Re-download the template and use those headers.`,
          confirmText: "OK",
        });
        setCsvParsed(null);
        setCsvValidation(null);
        return;
      }

      // Validate each row
      const results = parsed.data.map((row, i) => validateRow(row, i + 2, dupattaColorList)); // +2 = 1-based + header offset
      const errorCount = results.filter((r) => !r.ok).length;
      setCsvParsed(parsed);
      setCsvValidation({ results, errorCount });
    } catch (e) {
      console.error("CSV parse error:", e);
      showPopup({ type: "error", title: "Could not read file", message: e.message || String(e), confirmText: "OK" });
    }
  };

  // ─── CSV: run import on validated rows ───
  const handleRunImport = async () => {
    if (!csvValidation || csvValidation.errorCount > 0) return;
    const goodRows = csvValidation.results.filter((r) => r.ok).map((r) => r.normalized);
    if (goodRows.length === 0) return;

    setCsvImporting(true);
    setCsvProgress({ done: 0, total: goodRows.length, succeeded: 0, failed: 0 });

    // Resolve a starting SKU number for blank sku_ids — fetch once, then increment locally.
    let nextSkuNum = 0;
    try {
      // Paged past Supabase's 1000-row cap — duplicate-SKU risk, see above.
      // MUST read `products`, NOT `products_live` — same reason as fetchNextSku:
      // reserved barcode rows hold printed numbers and must be counted past.
      const { data: skuData } = await fetchAllRows("products", (q) => q
        .select("sku_id")
        .like("sku_id", "SKU-%"));
      let max = 0;
      (skuData || []).forEach((r) => {
        const m = (r.sku_id || "").match(/^SKU-(\d+)$/);
        if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
      });
      nextSkuNum = max + 1;
    } catch (e) {
      console.error("SKU pre-fetch failed:", e);
    }

    let succeeded = 0;
    let failed = 0;
    const failures = [];

    for (let i = 0; i < goodRows.length; i++) {
      const r = goodRows[i];

      // Resolve SKU
      let sku = r.sku_id || `SKU-${String(nextSkuNum).padStart(4, "0")}`;
      if (!r.sku_id) nextSkuNum += 1;

      // Build product row (Normal only — LXRTS via manual form)
      const productRow = {
        sku_id: sku,
        name: r.name,
        image_url: r.image_url,
        base_price: r.base_price,
        top_options: r.top_options,
        bottom_options: r.bottom_options,
        default_top: r.default_top,
        default_bottom: r.default_bottom,
        default_color: r.default_color,
        store_category: r.store_category || DEFAULT_STORE_CATEGORY,
        has_dupatta: r.has_dupatta,
        default_dupatta_color: r.default_dupatta_color,
        is_custom_piece: r.is_custom_piece,
        sync_enabled: false,
        inventory: r.inventory ?? 0,
        available_size: r.available_size,
        shopify_product_id: null,
      };

      // Insert product (one retry on SKU dupe)
      let inserted = null, lastErr = null;
      for (let attempt = 0; attempt < 2 && !inserted; attempt++) {
        const { data, error } = await supabase
          .from("products")
          .insert(productRow)
          .select()
          .single();
        if (!error) { inserted = data; break; }
        lastErr = error;
        const isDup = error.code === "23505" || /duplicate|unique/i.test(error.message || "");
        if (!isDup) break;
        // Bump and retry
        productRow.sku_id = `SKU-${String(nextSkuNum).padStart(4, "0")}`;
        sku = productRow.sku_id;
        nextSkuNum += 1;
      }

      if (!inserted) {
        failed += 1;
        failures.push({ name: r.name, error: lastErr?.message || "Unknown insert error" });
        setCsvProgress({ done: i + 1, total: goodRows.length, succeeded, failed });
        continue;
      }

      succeeded += 1;
      setCsvProgress({ done: i + 1, total: goodRows.length, succeeded, failed });
    }

    setCsvImporting(false);

    // Summary popup
    if (failed === 0) {
      showPopup({
        type: "success",
        title: "Import Complete",
        message: `${succeeded} product${succeeded !== 1 ? "s" : ""} imported successfully.`,
        confirmText: "OK",
      });
    } else {
      const sample = failures.slice(0, 3).map((f) => `• ${f.name}: ${f.error}`).join("\n");
      showPopup({
        type: "warning",
        title: "Import Finished with Errors",
        message: `${succeeded} succeeded, ${failed} failed.\n\nFirst failures:\n${sample}${failures.length > 3 ? `\n…and ${failures.length - 3} more.` : ""}`,
        confirmText: "OK",
      });
    }

    // Refresh the parent product list
    if (onProductAdded && succeeded > 0) onProductAdded(null);

    // Clear staged CSV (can re-upload another batch)
    setCsvFileName("");
    setCsvParsed(null);
    setCsvValidation(null);
    if (csvFileInputRef.current) csvFileInputRef.current.value = "";
  };

  return (
    <div className="add-product-root">
      {PopupComponent}

      {/* ── Mode toggle (Manual / CSV / Barcodes) ── */}
      <div className="ap-modebar">
        <button
          type="button"
          className={`ap-mode-btn ${mode === "manual" ? "active" : ""}`}
          onClick={() => setMode("manual")}
        >Manual Entry</button>
        <button
          type="button"
          className={`ap-mode-btn ${mode === "csv" ? "active" : ""}`}
          onClick={() => { setMode("csv"); setScanning(false); }}
        >CSV Import / Export</button>
        <button
          type="button"
          className={`ap-mode-btn ${mode === "barcodes" ? "active" : ""}`}
          onClick={() => { setMode("barcodes"); setScanning(false); }}
        >Export Barcodes</button>

        {/* Arming the scanner is a mode OF the manual form, not a separate
            screen — a scanned tag lands straight in the form below. */}
        <button
          type="button"
          className={`ap-mode-btn ap-scan-btn ${scanning && mode === "manual" ? "active" : ""}`}
          onClick={() => {
            setMode("manual");
            setScanning((on) => {
              if (on) { setTypeChooser(null); setScannedProduct(null); }
              return !on;
            });
          }}
        >
          {scanning && mode === "manual" ? "Scanning… (click to stop)" : "Scan Code"}
        </button>
      </div>

      {scanning && mode === "manual" && (
        <div className="ap-scan-strip">
          {scanResolving
            ? "Looking that up…"
            : formMode === "fillTag"
              ? `Filling in ${sku} — complete the form below and save.`
              : "Ready — scan a printed SKU tag."}
        </div>
      )}

      {/* Editing a live product — the form below is an UPDATE, not a new row. */}
      {formMode === "edit" && (
        <div className="ap-edit-strip">
          <span>
            Editing <strong>{sku}</strong> — changes overwrite this product.
          </span>
          <button type="button" className="ap-edit-strip-done" onClick={cancelScannedFill}>
            Done
          </button>
        </div>
      )}

      {/* Scanned a tag with no details yet — which kind of product is it? */}
      {typeChooser && (
        <SkuTypeChooser
          sku={typeChooser.sku}
          onPick={startFillingScanned}
          onCancel={cancelScannedFill}
        />
      )}

      {/* Scanned a tag that is already a real product — details, plus Edit. */}
      {scannedProduct && mode === "manual" && (
        <ScannedProductCard
          product={scannedProduct}
          onScanAnother={() => setScannedProduct(null)}
          onEdit={(p) => loadProductIntoForm(p, { mode: "edit" })}
        />
      )}

      {mode === "barcodes" && <BarcodeExportPanel />}

      {/* ── Product type toggle (Normal / LXRTS / Custom Piece) ──
          Hidden on the barcode sheet, which has no product type. */}
      {mode !== "barcodes" && (
      <div className="ap-typebar">
        <label className={`ap-type-pill ${productType === "normal" ? "active" : ""}`}>
          <input
            type="radio"
            name="productType"
            value="normal"
            checked={productType === "normal"}
            onChange={() => setProductType("normal")}
          />
          <span>Normal Product</span>
        </label>
        <label className={`ap-type-pill ${productType === "lxrts" ? "active" : ""}`}>
          <input
            type="radio"
            name="productType"
            value="lxrts"
            checked={productType === "lxrts"}
            onChange={() => setProductType("lxrts")}
          />
          <span>LXRTS (Shopify)</span>
        </label>
        <label className={`ap-type-pill ${productType === "custom_piece" ? "active" : ""}`}>
          <input
            type="radio"
            name="productType"
            value="custom_piece"
            checked={productType === "custom_piece"}
            onChange={() => setProductType("custom_piece")}
          />
          <span>Custom Piece</span>
        </label>
      </div>
      )}

      {mode === "manual" && (
        <form className="ap-form" onSubmit={handleSubmit}>

          {/* ── SKU + Name + Image + Pricing ── */}
          <div className="ap-grid-2">
            <div className="ap-field">
              <label>SKU</label>
              <div className="ap-sku-row">
                <input
                  className={`ap-input ${formMode !== "create" ? "ap-input-locked" : ""}`}
                  value={skuLoading ? "Generating…" : sku}
                  readOnly
                />
                {formMode !== "create" ? (
                  // No re-roll on either path: this number is printed on the
                  // garment in hand, so it can't be moved to another product.
                  <button
                    type="button"
                    className="ap-mini-btn"
                    onClick={cancelScannedFill}
                    title={formMode === "edit"
                      ? "Stop editing and go back to a new product"
                      : "Discard this scan and go back to a new product"}
                  >✕</button>
                ) : (
                  <button type="button" className="ap-mini-btn" onClick={refreshSku} title="Re-fetch the next available SKU">↻</button>
                )}
              </div>
              <span className="ap-help">
                {formMode === "fillTag"
                  ? "Locked — from the scanned tag. Saving fills in this barcode."
                  : formMode === "edit"
                    ? "Locked — editing an existing product. Its SKU can't change."
                    : "Auto-generated. Refresh if you suspect another product was just added."}
              </span>
            </div>

            <div className="ap-field">
              <label>Product Name <span className="ap-req">*</span></label>
              <input
                className="ap-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Hafsa - Burnt Orange Chauga with Salwar"
              />
            </div>

            <div className="ap-field ap-field-wide">
              <label>Image URL</label>
              <input
                className="ap-input"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://cdn.shopify.com/..."
              />
              {imageUrl && (
                <div className="ap-img-preview">
                  <img src={imageUrl} alt="preview" onError={(e) => e.target.style.display = "none"} />
                </div>
              )}
            </div>

            <div className="ap-field">
              <label>Base Price (₹) <span className="ap-req">*</span></label>
              <input
                type="number"
                className="ap-input"
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                min="0"
              />
            </div>
          </div>

          {/* ── Options (chip inputs) ── */}
          <h3 className="ap-section-title">Options</h3>
          <div className="ap-grid-2">
            <div className="ap-field ap-field-wide">
              <label>Top Options</label>
              <ChipInput
                value={topOptions}
                onChange={setTopOptions}
                suggestions={topSuggest}
                placeholder="e.g. Kurta, Choga, Anarkali…"
              />
              <span className="ap-help">Type a value and press Enter — or pick from existing.</span>
            </div>
            <div className="ap-field ap-field-wide">
              <label>Bottom Options</label>
              <ChipInput
                value={bottomOptions}
                onChange={setBottomOptions}
                suggestions={bottomSuggest}
                placeholder="e.g. Salwar, Lehenga, Sharara…"
              />
            </div>
          </div>

          {/* ── Defaults (pick one of each option list) ── */}
          <h3 className="ap-section-title">Defaults (Pre-selected on order form)</h3>
          <div className="ap-grid-3">
            <div className="ap-field">
              <label>Default Top</label>
              <select className="ap-input" value={defaultTop} onChange={(e) => setDefaultTop(e.target.value)}>
                <option value="">—</option>
                {topOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="ap-field">
              <label>Default Bottom</label>
              <select className="ap-input" value={defaultBottom} onChange={(e) => setDefaultBottom(e.target.value)}>
                <option value="">—</option>
                {bottomOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="ap-field">
              <label>Default Color</label>
              {/* Sourced from the `colors` table so the saved name exactly
                  matches what ProductForm looks up to find the hex.
                  If the color you need isn't here, add it to the `colors`
                  table first (Supabase Studio) and refresh this page. */}
              <select
                className="ap-input"
                value={defaultColor}
                onChange={(e) => setDefaultColor(e.target.value)}
              >
                <option value="">— Select a color —</option>
                {colorList.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              {/* Tiny swatch preview when a color is picked */}
              {defaultColor && (() => {
                const picked = colorList.find((c) => c.name === defaultColor);
                if (!picked?.hex) return null;
                return (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <span style={{ display: 'inline-block', width: 14, height: 14, background: picked.hex, border: '1px solid #ccc', borderRadius: 3 }} />
                    <span style={{ fontSize: 11, color: '#888' }}>{picked.hex}</span>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── Store category ── */}
          <h3 className="ap-section-title">Store</h3>
          <div className="ap-grid-3">
            <div className="ap-field">
              <label>Store Category</label>
              <select
                className="ap-input"
                value={storeCategory}
                onChange={(e) => setStoreCategory(e.target.value)}
              >
                {STORE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <span className="ap-help">
                "All Stores" shows in every store's order form. "Delhi"/"Ludhiana" show only to that store's SAs.
              </span>
            </div>

            <div className="ap-field">
              <label>Dupatta</label>
              <label className="ap-checkbox-row">
                <input
                  type="checkbox"
                  checked={hasDupatta}
                  onChange={(e) => setHasDupatta(e.target.checked)}
                />
                <span>Includes a dupatta</span>
              </label>
              <span className="ap-help">
                Tick if this outfit comes with a dupatta. Orders then track the dupatta as its own piece with a separate barcode.
              </span>
            </div>

            {/* Dupatta colour — only relevant once the product has a dupatta.
                Its own list (dupatta_colors), separate from Default Color,
                because the dupatta is often a deliberate contrast piece. */}
            {hasDupatta && (
              <div className="ap-field">
                <label>Dupatta Color</label>
                <select
                  className="ap-input"
                  value={defaultDupattaColor}
                  onChange={(e) => setDefaultDupattaColor(e.target.value)}
                >
                  <option value="">— Same as Default Color —</option>
                  {dupattaColorList.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <span className="ap-help">
                  Pre-fills the Dupatta Color on the order form. Leave blank to use the Default Color.
                </span>
              </div>
            )}
          </div>

          {/* ── Sizes + inventory (Normal and Custom Piece both use this shape) ── */}
          {(productType === "normal" || productType === "custom_piece") && (
            <>
              <h3 className="ap-section-title">
                Inventory ({productType === "custom_piece" ? "Custom Piece" : "Normal Product"})
              </h3>
              <div className="ap-field">
                <div className="ap-size-label-row">
                  <label>Available Sizes</label>
                  <button
                    type="button"
                    className="ap-size-toggle-all"
                    onClick={() => {
                      // Toggle: if all are selected, clear; otherwise select all
                      setAvailableSizes((prev) =>
                        prev.length === SIZE_OPTIONS.length ? [] : [...SIZE_OPTIONS]
                      );
                    }}
                  >
                    {availableSizes.length === SIZE_OPTIONS.length ? "Unselect All" : "Select All"}
                  </button>
                </div>
                <div className="ap-size-grid">
                  {SIZE_OPTIONS.map((s) => {
                    const checked = availableSizes.includes(s);
                    return (
                      <button
                        type="button"
                        key={s}
                        className={`ap-size-pill ${checked ? "active" : ""}`}
                        onClick={() => {
                          setAvailableSizes((prev) =>
                            checked ? prev.filter((x) => x !== s) : [...prev, s]
                          );
                        }}
                      >{s}</button>
                    );
                  })}
                </div>
              </div>

              <div className="ap-grid-2">
                <div className="ap-field">
                  <label>Stock</label>
                  <input
                    type="number"
                    className="ap-input"
                    value={isMto ? 9999 : inventory}
                    onChange={(e) => setInventory(e.target.value)}
                    disabled={isMto}
                    min="0"
                  />
                </div>
                <div className="ap-field">
                  <label>&nbsp;</label>
                  <label className="ap-checkbox-row">
                    <input
                      type="checkbox"
                      checked={isMto}
                      onChange={(e) => setIsMto(e.target.checked)}
                    />
                    <span>Made-to-Order (unlimited stock — saves as 9999)</span>
                  </label>
                </div>
              </div>
            </>
          )}

          {/* ── LXRTS-only: Shopify ID + per-size variants ── */}
          {productType === "lxrts" && (
            <>
              <h3 className="ap-section-title">LXRTS / Shopify</h3>
              <div className="ap-field ap-field-wide">
                <label>Shopify Product ID <span className="ap-req">*</span></label>
                <input
                  className="ap-input"
                  value={shopifyProductId}
                  onChange={(e) => setShopifyProductId(e.target.value)}
                  placeholder="gid://shopify/Product/1234567890"
                />
              </div>

              <h3 className="ap-section-title">Size Variants</h3>
              <p className="ap-help ap-variant-note">
                This product must already exist on Shopify. <strong>Shopify owns the stock:</strong>{" "}
                {formMode === "edit"
                  ? "changing Inventory here updates Shopify to match."
                  : "on save, Inventory is replaced with Shopify's live figure — so a number typed here is only a placeholder."}{" "}
                Sizes are matched to Shopify <strong>by name</strong>; a size Shopify doesn't
                have will never sync, and can't be created from here.
              </p>
              <div className="ap-table-wrapper">
                <table className="ap-variant-table">
                  <thead>
                    <tr>
                      <th>Size *</th>
                      <th>Price (₹)</th>
                      <th>Inventory</th>
                      <th>Shopify Variant ID</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {variants.map((v, i) => (
                      <tr key={i}>
                        <td>
                          <select className="ap-input" value={v.size} onChange={(e) => updateVariant(i, "size", e.target.value)}>
                            <option value="">—</option>
                            {SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            className="ap-input"
                            value={v.price}
                            onChange={(e) => updateVariant(i, "price", e.target.value)}
                            placeholder={basePrice || "—"}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="ap-input"
                            value={v.inventory}
                            onChange={(e) => updateVariant(i, "inventory", e.target.value)}
                            min="0"
                          />
                        </td>
                        <td>
                          <input
                            className="ap-input"
                            value={v.shopify_variant_id}
                            onChange={(e) => updateVariant(i, "shopify_variant_id", e.target.value)}
                            placeholder="gid://shopify/ProductVariant/..."
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="ap-row-remove"
                            onClick={() => removeVariantRow(i)}
                            disabled={variants.length === 1}
                            title="Remove row"
                          >×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className="ap-mini-btn ap-add-variant" onClick={addVariantRow}>
                + Add Size
              </button>
            </>
          )}

          {/* ── Submit / Reset ── */}
          <div className="ap-actions">
            <button type="button" className="ap-btn-secondary" onClick={resetForm} disabled={submitting}>
              Reset
            </button>
            <button type="submit" className="ap-btn-primary" disabled={submitting || skuLoading}>
              {submitting
                ? "Saving…"
                : formMode === "edit" ? "Update Product" : "Save Product"}
            </button>
          </div>
        </form>
      )}

      {mode === "csv" && (
        <div className="ap-csv-block">
          {/* ── Toolbar: Template / Export / Import ── */}
          <div className="ap-csv-toolbar">
            <button
              type="button"
              className="ap-btn-secondary"
              onClick={handleDownloadTemplate}
              disabled={csvImporting}
              title="Download an empty template with column headers and demo rows"
            >⬇ Download Template</button>

            <button
              type="button"
              className="ap-btn-secondary"
              onClick={handleExportAll}
              disabled={csvExporting || csvImporting}
              title="Download every existing product (and its variants for LXRTS)"
            >{csvExporting ? "Exporting…" : "⬇ Export All Products"}</button>

            <label className="ap-btn-primary ap-csv-import-label">
              ⬆ Import CSV
              <input
                ref={csvFileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => handleCsvFile(e.target.files?.[0])}
                disabled={csvImporting}
                style={{ display: "none" }}
              />
            </label>
          </div>

          <p className="ap-help">
            CSV import supports <strong>Normal products only</strong>. For LXRTS (Shopify-synced)
            products, switch to <strong>Manual Entry</strong> above. List fields are{" "}
            <strong>pipe-separated</strong> (e.g. <code>Kurta|Choga|Anarkali</code>). Use{" "}
            <code>MTO</code> in <code>inventory</code> for unlimited (made-to-order) stock.
            Leave <code>sku_id</code> blank to auto-generate.
          </p>

          {/* ── Validation summary + preview ── */}
          {csvParsed && csvValidation && (
            <>
              <div className="ap-csv-summary">
                <strong>{csvFileName}</strong> — {csvParsed.data.length} row{csvParsed.data.length !== 1 ? "s" : ""}
                {csvValidation.errorCount > 0 ? (
                  <span className="ap-csv-summary-bad">
                    {" · "}{csvValidation.errorCount} row{csvValidation.errorCount !== 1 ? "s" : ""} with errors
                  </span>
                ) : (
                  <span className="ap-csv-summary-ok">{" · all rows valid"}</span>
                )}
              </div>

              <div className="ap-table-wrapper">
                <table className="ap-variant-table ap-csv-preview">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Name</th>
                      <th>Base Price</th>
                      <th>Sizes</th>
                      <th>Inventory</th>
                      <th>Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvParsed.data.map((row, i) => {
                      const v = csvValidation.results[i];
                      return (
                        <tr key={i} className={v.ok ? "" : "ap-csv-row-bad"}>
                          <td>{i + 2}</td>
                          <td>{row.name || "—"}</td>
                          <td>{row.base_price || "—"}</td>
                          <td className="ap-csv-cell-trunc">{row.available_size || "—"}</td>
                          <td>{row.inventory || "—"}</td>
                          <td className="ap-csv-cell-errors">
                            {v.ok ? "—" : v.errors.join(" · ")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Progress bar (during import) */}
              {csvImporting && (
                <div className="ap-csv-progress">
                  Importing {csvProgress.done} / {csvProgress.total}{" "}
                  ({csvProgress.succeeded} ok, {csvProgress.failed} failed)…
                </div>
              )}

              {/* Run import button */}
              <div className="ap-actions">
                <button
                  type="button"
                  className="ap-btn-secondary"
                  onClick={() => {
                    setCsvFileName("");
                    setCsvParsed(null);
                    setCsvValidation(null);
                    if (csvFileInputRef.current) csvFileInputRef.current.value = "";
                  }}
                  disabled={csvImporting}
                >Discard</button>
                <button
                  type="button"
                  className="ap-btn-primary"
                  onClick={handleRunImport}
                  disabled={csvImporting || csvValidation.errorCount > 0 || csvParsed.data.length === 0}
                  title={csvValidation.errorCount > 0 ? "Fix errors in the file and re-upload" : ""}
                >
                  {csvImporting ? "Importing…" : `Import ${csvParsed.data.length} row${csvParsed.data.length !== 1 ? "s" : ""}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
