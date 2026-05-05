import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { usePopup } from "../Popup";
import {
  CSV_COLUMNS,
  TEMPLATE_DEMO_ROWS,
  buildCsv,
  downloadCsv,
  parseCsv,
  validateRow,
} from "./csvHelpers";
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
  const { data, error } = await supabase
    .from("products")
    .select("sku_id")
    .like("sku_id", "SKU-%");
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
export default function AddProduct({ onProductAdded }) {
  const { showPopup, PopupComponent } = usePopup();

  // Mode toggles
  const [mode, setMode] = useState("manual");           // 'manual' | 'csv'
  const [productType, setProductType] = useState("normal"); // 'normal' | 'lxrts'

  // Auto-SKU
  const [sku, setSku] = useState("");
  const [skuLoading, setSkuLoading] = useState(true);

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

  // Suggestions for chip inputs (top/bottom/color), pulled once on mount
  const [topSuggest, setTopSuggest] = useState([]);
  const [bottomSuggest, setBottomSuggest] = useState([]);
  const [colorSuggest, setColorSuggest] = useState([]);

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

      // Pull existing options + colors to use as autocomplete suggestions.
      // We grab the raw arrays/strings and union them client-side because
      // Supabase doesn't easily expose `unnest()` over the JS client.
      const { data } = await supabase
        .from("products")
        .select("top_options, bottom_options, default_color");
      if (!alive || !data) return;
      const t = new Set(), b = new Set(), c = new Set();
      data.forEach((p) => {
        (p.top_options || []).forEach((v) => v && t.add(String(v).trim()));
        (p.bottom_options || []).forEach((v) => v && b.add(String(v).trim()));
        if (p.default_color) c.add(String(p.default_color).trim());
      });
      setTopSuggest([...t].sort());
      setBottomSuggest([...b].sort());
      setColorSuggest([...c].sort());
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
    setAvailableSizes([]); setInventory("0"); setIsMto(false);
    setShopifyProductId("");
    setVariants([{ size: "", price: "", inventory: "0", shopify_variant_id: "" }]);
    refreshSku();
  };

  // ─── Validation ───
  const validate = () => {
    if (!name.trim()) return "Product name is required.";
    if (!basePrice || Number(basePrice) <= 0) return "Base price must be greater than 0.";

    if (productType === "normal") {
      if (!isMto && availableSizes.length === 0) return "Pick at least one available size, or mark as Made-to-Order.";
      if (!isMto && (inventory === "" || isNaN(Number(inventory)))) return "Inventory must be a number.";
    } else {
      // LXRTS
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
      sync_enabled: productType === "lxrts",
    };

    if (productType === "normal") {
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

    // Insert with one retry if SKU race-collides.
    let attempt = 0;
    let inserted = null;
    let lastError = null;
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

    if (!inserted) {
      console.error("Insert failed:", lastError);
      showPopup({ type: "error", title: "Insert Failed", message: lastError?.message || "Could not save product.", confirmText: "OK" });
      setSubmitting(false);
      return;
    }

    // For LXRTS, insert the variant rows. If this fails we roll back the product.
    if (productType === "lxrts") {
      const variantRows = variants
        .filter((v) => v.size && v.size.trim())
        .map((v) => ({
          product_id: inserted.id,
          size: v.size.trim().toUpperCase(),
          price: v.price ? Number(v.price) : Number(basePrice),
          inventory: Number(v.inventory) || 0,
          shopify_variant_id: v.shopify_variant_id?.trim() || null,
        }));
      const { error: varErr } = await supabase.from("product_variants").insert(variantRows);
      if (varErr) {
        // Rollback the product so the form can be retried cleanly.
        await supabase.from("products").delete().eq("id", inserted.id);
        console.error("Variants insert failed:", varErr);
        showPopup({
          type: "error",
          title: "Variants Failed",
          message: `Product was rolled back. Variant error: ${varErr.message}`,
          confirmText: "OK",
        });
        setSubmitting(false);
        return;
      }
    }

    showPopup({
      type: "success",
      title: "Product Added",
      message: `${inserted.name} (${inserted.sku_id}) saved successfully.`,
      confirmText: "OK",
    });
    if (onProductAdded) onProductAdded(inserted);
    resetForm();
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
      const { data: prods, error: pErr } = await supabase
        .from("products")
        .select("*")
        .eq("sync_enabled", false)
        .order("sku_id", { ascending: true });
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
      const results = parsed.data.map((row, i) => validateRow(row, i + 2)); // +2 = 1-based + header offset
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
      const { data: skuData } = await supabase
        .from("products")
        .select("sku_id")
        .like("sku_id", "SKU-%");
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

      {/* ── Mode toggle (Manual / CSV) ── */}
      <div className="ap-modebar">
        <button
          type="button"
          className={`ap-mode-btn ${mode === "manual" ? "active" : ""}`}
          onClick={() => setMode("manual")}
        >Manual Entry</button>
        <button
          type="button"
          className={`ap-mode-btn ${mode === "csv" ? "active" : ""}`}
          onClick={() => setMode("csv")}
        >CSV Import / Export</button>
      </div>

      {/* ── Product type toggle (Normal / LXRTS) ── */}
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
      </div>

      {mode === "manual" && (
        <form className="ap-form" onSubmit={handleSubmit}>

          {/* ── SKU + Name + Image + Pricing ── */}
          <div className="ap-grid-2">
            <div className="ap-field">
              <label>SKU</label>
              <div className="ap-sku-row">
                <input className="ap-input" value={skuLoading ? "Generating…" : sku} readOnly />
                <button type="button" className="ap-mini-btn" onClick={refreshSku} title="Re-fetch the next available SKU">↻</button>
              </div>
              <span className="ap-help">Auto-generated. Refresh if you suspect another product was just added.</span>
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
              <input
                className="ap-input"
                value={defaultColor}
                onChange={(e) => setDefaultColor(e.target.value)}
                placeholder="e.g. Burnt Orange"
                list="ap-color-suggest"
              />
              <datalist id="ap-color-suggest">
                {colorSuggest.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>

          {/* ── Normal-only: sizes + inventory ── */}
          {productType === "normal" && (
            <>
              <h3 className="ap-section-title">Inventory (Normal Product)</h3>
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
              {submitting ? "Saving…" : "Save Product"}
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
