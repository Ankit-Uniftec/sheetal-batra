import React, { useEffect, useMemo, useState } from "react";
import { FormModal, Field, Icon, SearchSelect } from "./StockRoomUi";
import {
  loadProductFormOptions, loadProductForEdit, loadLiveProductNames, findShopifyIdUsers, fetchNextSku,
  createProduct, updateProduct, createCollection, setProductCollections, placeStock, newRequestId,
} from "./stockRoomData";
import { readShopifyStock, SHOPIFY_SYNC_ON } from "./stockRoomShopify";
import { checkDuplicateName, SIZE_OPTIONS } from "../../components/AddProduct/csvHelpers";
import { STORE_CATEGORIES, DEFAULT_STORE_CATEGORY } from "../../utils/storeCategory";
import { normalizeShopifyId } from "../../utils/shopifyInventory";
import { formatUnits, UNLIMITED_SENTINEL, TYPE_LXRTS, TYPE_CUSTOM, TYPE_MTO, TYPE_LABELS, productType } from "./stockRoomModel";

// ============================================================
// Stock Room — add or edit a product.
//
// Writes the same columns, the same way, as components/AddProduct/AddProduct.jsx,
// so the order form cannot tell where a product was created.
//
// What it deliberately does not do:
//   * change a product's type after creation (its stock would change meaning);
//   * change stock counts on an existing product — that is what the Stock
//     actions are for, so every change is recorded as a movement;
//   * offer 7XL / 8XL: above 6XL is made as a Custom size.
// ============================================================

// Sizes that can be chosen. Sizes above 6XL already on a product are kept.
const OFFERED_SIZES = SIZE_OPTIONS.filter((s) => s !== "7XL" && s !== "8XL");
// Made to order / custom pieces use 2XL; LXRTS size names must match Shopify's variants, which use XXL.
const LISTED_SIZES = OFFERED_SIZES.filter((s) => s !== "XXL");

const TYPES = [
  { value: TYPE_MTO, label: "Made to order", note: "No stock is held; every size can always be ordered." },
  { value: TYPE_CUSTOM, label: "Custom piece", note: "Real pieces, counted as one number for the design." },
  { value: TYPE_LXRTS, label: "LXRTS", note: "Ready to ship, synced with Shopify, counted per size." },
];

/** Free-text chips with suggestions (top / bottom options). */
function ChipsInput({ value, onChange, suggestions, placeholder, id }) {
  const [text, setText] = useState("");
  const add = (raw) => {
    const v = String(raw || "").trim();
    if (!v || value.some((x) => x.toLowerCase() === v.toLowerCase())) { setText(""); return; }
    onChange([...value, v]);
    setText("");
  };
  return (
    <span className="sr-chips-input">
      {value.map((v) => (
        <span key={v} className="sr-fpill">{v}<button type="button" className="sr-fpill-x" onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`Remove ${v}`}>×</button></span>
      ))}
      <input className="sr-chips-text" list={id} value={text} placeholder={value.length ? "" : placeholder}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(",")) add(v.slice(0, -1)); else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); add(text); }
          if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text && add(text)} />
      <datalist id={id}>{suggestions.filter((s) => !value.includes(s)).slice(0, 200).map((s) => <option key={s} value={s} />)}</datalist>
    </span>
  );
}

const blankVariant = () => ({ key: Math.random().toString(36).slice(2), id: null, size: "", price: "", shopifyVariantId: "", inventory: "0", stock: 0 });

export default function ProductEditor({ productId, view, onClose, onDone }) {
  const isEdit = !!productId;
  const ledger = view.ledger;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [options, setOptions] = useState({ tops: [], bottoms: [], colors: [], dupattaColors: [] });
  const [liveNames, setLiveNames] = useState([]);
  const [original, setOriginal] = useState(null);

  const [type, setType] = useState(TYPE_MTO);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [storeCategory, setStoreCategory] = useState(DEFAULT_STORE_CATEGORY);
  const [tops, setTops] = useState([]);
  const [bottoms, setBottoms] = useState([]);
  const [defaultTop, setDefaultTop] = useState("");
  const [defaultBottom, setDefaultBottom] = useState("");
  const [defaultColor, setDefaultColor] = useState("");
  const [hasDupatta, setHasDupatta] = useState(false);
  const [dupattaColor, setDupattaColor] = useState("");
  const [sizes, setSizes] = useState([]);
  const [inventory, setInventory] = useState("0");
  const [shopifyId, setShopifyId] = useState("");
  const [variants, setVariants] = useState([blankVariant()]);
  const [collectionIds, setCollectionIds] = useState([]);
  const [newCollection, setNewCollection] = useState("");
  const [extraCollections, setExtraCollections] = useState([]);
  // New products only: where the opening pieces are. { [locationId]: { [size]: "qty" } }
  const [openingLocations, setOpeningLocations] = useState([]);
  const [opening, setOpening] = useState({});

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [opts, names] = await Promise.all([loadProductFormOptions(), loadLiveProductNames()]);
        if (!alive) return;
        setOptions(opts);
        setLiveNames(names);
        if (isEdit) {
          const { product, variants: rows } = await loadProductForEdit(productId);
          if (!alive) return;
          setOriginal({ product, variants: rows });
          setType(productType(product));
          setSku(product.sku_id || "");
          setName(product.name || "");
          setBasePrice(product.base_price != null ? String(product.base_price) : "");
          setImageUrl(product.image_url || "");
          setStoreCategory(product.store_category || DEFAULT_STORE_CATEGORY);
          setTops(product.top_options || []);
          setBottoms(product.bottom_options || []);
          setDefaultTop(product.default_top || "");
          setDefaultBottom(product.default_bottom || "");
          setDefaultColor(product.default_color || "");
          setHasDupatta(!!product.has_dupatta);
          setDupattaColor(product.default_dupatta_color || "");
          setSizes(product.available_size || []);
          setInventory(String(product.inventory ?? 0));
          setShopifyId(product.shopify_product_id || "");
          setVariants(rows.length ? rows.map((v) => ({
            key: v.id, id: v.id, size: v.size || "", price: v.price != null ? String(v.price) : "",
            shopifyVariantId: v.shopify_variant_id || "", inventory: String(v.inventory ?? 0), stock: v.inventory ?? 0,
          })) : [blankVariant()]);
          setCollectionIds(ledger?.collectionsByProduct?.[productId] || []);
        } else {
          const next = await fetchNextSku();
          if (alive) setSku(next);
        }
      } catch (e) {
        if (alive) setLoadError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // Loads once per opened product: a background refresh must not wipe what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, productId]);

  const collections = useMemo(() => [...(ledger?.collections || []), ...extraCollections], [ledger, extraCollections]);
  const placedTotal = isEdit ? (ledger?.placementById?.[productId]?.placedTotal || 0) : 0;
  const placedBySize = isEdit ? (ledger?.placementById?.[productId]?.placedBySize || {}) : {};

  // Keeps sizes in garment order, with any older off-list sizes after them.
  const toggleSize = (s) => setSizes((cur) => (cur.includes(s)
    ? cur.filter((x) => x !== s)
    : [...LISTED_SIZES.filter((x) => x === s || cur.includes(x)), ...cur.filter((x) => !LISTED_SIZES.includes(x))]));
  const updateVariant = (key, patch) => setVariants((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  // Create mode, LXRTS: one switch per size instead of free rows.
  const variantFor = (size) => variants.find((v) => v.size === size);
  const toggleVariantSize = (size) => setVariants((vs) => {
    const filled = vs.filter((v) => v.size);
    if (filled.some((v) => v.size === size)) return filled.filter((v) => v.size !== size);
    const next = [...filled, { ...blankVariant(), size }];
    return next.sort((x, y) => OFFERED_SIZES.indexOf(x.size) - OFFERED_SIZES.indexOf(y.size));
  });

  // ---- opening stock by location (new LXRTS / custom products) ----
  const tracksStock = type === TYPE_LXRTS || type === TYPE_CUSTOM;
  const canPlaceOpening = !isEdit && tracksStock && !!ledger?.installed;
  const openingSizes = type === TYPE_LXRTS ? variants.filter((v) => v.size).map((v) => v.size) : sizes;
  const piecesFor = (size) => (type === TYPE_LXRTS ? Number(variantFor(size)?.inventory) || 0 : null);
  const openingQty = (loc, size) => Number(opening[loc]?.[size]) || 0;
  const placedOpening = (size) => openingLocations.reduce((a, loc) => a + openingQty(loc, size), 0);
  const placedOpeningAll = openingSizes.reduce((a, s) => a + placedOpening(s), 0);
  const setOpeningQty = (loc, size, value) => setOpening((o) => ({ ...o, [loc]: { ...(o[loc] || {}), [size]: value } }));
  const locationChoices = (ledger?.locations || []).filter((l) => !openingLocations.includes(l.id)).map((l) => ({ value: l.id, label: `${l.name}${l.kind === "store" ? " · store" : ""}` }));

  const validate = () => {
    if (!name.trim()) return "Enter the design name.";
    const price = Number(basePrice);
    if (!basePrice || !Number.isFinite(price) || price <= 0) return "Enter a price above zero.";
    if (defaultTop && tops.length && !tops.includes(defaultTop)) return "The default top must be one of the top options.";
    if (defaultBottom && bottoms.length && !bottoms.includes(defaultBottom)) return "The default bottom must be one of the bottom options.";
    if (defaultColor && options.colors.length && !options.colors.some((c) => c.name === defaultColor)) return "Choose the default colour from the list.";
    if (canPlaceOpening) {
      for (const loc of openingLocations) {
        for (const size of openingSizes) {
          const raw = opening[loc]?.[size];
          if (raw && (!Number.isInteger(Number(raw)) || Number(raw) < 0)) return "Opening stock must be whole numbers.";
        }
      }
      if (type === TYPE_LXRTS) {
        const over = openingSizes.find((size) => placedOpening(size) > piecesFor(size));
        if (over) return `Size ${over}: more pieces are placed in locations than the ${piecesFor(over)} entered.`;
      } else if (placedOpeningAll > (Number(inventory) || 0)) {
        return `More pieces are placed in locations than the ${Number(inventory) || 0} on hand.`;
      }
    }
    if (type !== TYPE_LXRTS) {
      if (!sizes.length) return "Choose at least one size.";
      if (type === TYPE_CUSTOM && !isEdit) {
        const n = Number(inventory);
        if (!Number.isInteger(n) || n < 0) return "Enter how many pieces there are (0 or more).";
      }
    } else {
      const gid = normalizeShopifyId(shopifyId, "Product");
      if (!/^gid:\/\/shopify\/Product\/\d+$/.test(gid)) return "Enter the Shopify product ID (the number from Shopify, or its gid://shopify/Product/… form).";
      const filled = variants.filter((v) => v.size);
      if (!filled.length) return "Add at least one size.";
      const seen = new Set();
      for (const v of filled) {
        if (seen.has(v.size) && !v.id) return `Size ${v.size} is listed twice.`;
        seen.add(v.size);
        if (v.price && !(Number(v.price) > 0)) return `Size ${v.size}: the price must be above zero, or left empty to use the design price.`;
        if (!v.id && (!Number.isInteger(Number(v.inventory)) || Number(v.inventory) < 0)) return `Size ${v.size}: enter the pieces on hand (0 or more).`;
      }
    }
    return null;
  };

  const save = async () => {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setSubmitting(true);
    setError("");
    try {
      // Same duplicate-name rule as AddProduct and the CSV import.
      const dup = checkDuplicateName(name, storeCategory, liveNames.filter((p) => p.id !== productId));
      if (!dup.ok) throw new Error(dup.error);
      const finalName = dup.renameTo || name.trim();

      const gid = type === TYPE_LXRTS ? normalizeShopifyId(shopifyId, "Product") : null;
      if (gid) {
        const users = await findShopifyIdUsers(gid, productId);
        if (users.length) throw new Error(`Shopify ID already used by ${users.map((u) => `${u.name} (${u.sku_id})`).join(", ")}. Two designs sharing one ID share one Shopify stock count.`);
      }

      const row = {
        name: finalName,
        image_url: imageUrl.trim() || null,
        base_price: Number(basePrice),
        top_options: tops.length ? tops : null,
        bottom_options: bottoms.length ? bottoms : null,
        default_top: defaultTop || null,
        default_bottom: defaultBottom || null,
        default_color: defaultColor.trim() || null,
        store_category: storeCategory || DEFAULT_STORE_CATEGORY,
        has_dupatta: hasDupatta,
        default_dupatta_color: hasDupatta ? (dupattaColor.trim() || defaultColor.trim() || null) : null,
      };

      let saved;
      if (!isEdit) {
        Object.assign(row, {
          sku_id: sku,
          sync_enabled: type === TYPE_LXRTS,
          is_custom_piece: type === TYPE_CUSTOM,
          shopify_product_id: gid,
          available_size: type === TYPE_LXRTS ? null : sizes,
          inventory: type === TYPE_MTO ? UNLIMITED_SENTINEL : type === TYPE_CUSTOM ? Number(inventory) : 0,
        });
        const variantRows = type !== TYPE_LXRTS ? [] : async (newId) => {
          // With Shopify sync on, Shopify's own count wins, exactly as AddProduct does.
          const live = await readShopifyStock(newId);
          return variants.filter((v) => v.size).map((v) => ({
            size: v.size,
            price: v.price ? Number(v.price) : Number(basePrice),
            inventory: live && live[v.size] !== undefined ? live[v.size] : Number(v.inventory) || 0,
            shopify_variant_id: normalizeShopifyId(v.shopifyVariantId, "ProductVariant") || null,
          }));
        };
        saved = await createProduct(row, variantRows);
      } else {
        if (type === TYPE_LXRTS) row.shopify_product_id = gid;
        else row.available_size = sizes;
        const changes = { updateVariants: [], addVariants: [], removeVariantIds: [] };
        if (type === TYPE_LXRTS) {
          const keptIds = new Set(variants.filter((v) => v.id).map((v) => v.id));
          original.variants.forEach((ov) => { if (!keptIds.has(ov.id)) changes.removeVariantIds.push(ov.id); });
          variants.filter((v) => v.size).forEach((v) => {
            const fields = {
              price: v.price ? Number(v.price) : Number(basePrice),
              shopify_variant_id: normalizeShopifyId(v.shopifyVariantId, "ProductVariant") || null,
            };
            if (v.id) changes.updateVariants.push({ id: v.id, ...fields });
            else changes.addVariants.push({ size: v.size, inventory: 0, ...fields });
          });
        }
        saved = await updateProduct(productId, row, changes);
      }

      if (ledger?.installed) {
        await setProductCollections(saved.id, collectionIds, isEdit ? (ledger.collectionsByProduct[productId] || []) : []);
      }

      // Opening stock: the product exists now, so each location is a normal
      // placement. A failure here leaves the pieces unassigned, never lost.
      let placedNote = "";
      let placeFailed = false;
      if (canPlaceOpening && placedOpeningAll > 0) {
        let placedUnits = 0;
        for (const loc of openingLocations) {
          const lines = openingSizes.map((size) => ({ productId: saved.id, size, qty: openingQty(loc, size) })).filter((l) => l.qty > 0);
          if (!lines.length) continue;
          try {
            await placeStock({ requestId: newRequestId(), locationId: loc, lines, note: "Opening stock" });
            placedUnits += lines.reduce((a, l) => a + l.qty, 0);
          } catch (e) {
            placeFailed = true;
            placedNote += ` Could not place stock in ${ledger.locationsById[loc]?.name || "a location"}: ${e.message}`;
          }
        }
        if (placedUnits) placedNote = ` ${formatUnits(placedUnits)} placed in locations.${placedNote}`;
      }

      const renamed = dup.renameTo ? ` Saved as "${finalName}" because that name already exists for another store.` : "";
      onDone({ text: `${saved.name} (${saved.sku_id}) ${isEdit ? "saved" : "added"}.${renamed}${placedNote}`, tone: placeFailed ? "crit" : renamed ? "warn" : "ok" });
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  const addCollection = async () => {
    const n = newCollection.trim();
    if (!n) return;
    const existing = collections.find((c) => c.name.toLowerCase() === n.toLowerCase());
    try {
      const c = existing || await createCollection(n);
      if (!existing) setExtraCollections((xs) => [...xs, c]);
      setCollectionIds((ids) => (ids.includes(c.id) ? ids : [...ids, c.id]));
      setNewCollection("");
    } catch (e) {
      setError(e.message);
    }
  };

  const title = isEdit ? `Edit ${original?.product?.name || "product"}` : "Add a product";

  if (loading || loadError) {
    return (
      <FormModal title={title} onClose={onClose} onSubmit={() => {}} submitLabel="Save" disabled error={loadError}>
        {!loadError && <div className="sr-state-box" style={{ margin: "30px auto" }}><span className="sr-spinner" /><span className="sr-muted">Loading…</span></div>}
      </FormModal>
    );
  }

  const legacySizes = sizes.filter((s) => !LISTED_SIZES.includes(s));

  return (
    <FormModal title={title} sub={isEdit ? `${sku} · ${TYPE_LABELS[type]}` : "Saved exactly as the Add Product form saves it."}
      onClose={onClose} onSubmit={save} submitLabel={isEdit ? "Save product" : "Add product"} submitting={submitting} error={error} width={940}>

      <h3 className="sr-form-section">Type</h3>
      {isEdit ? (
        <p className="sr-muted" style={{ marginBottom: 18 }}>{TYPE_LABELS[type]}. A product's type can't be changed after it is created.</p>
      ) : (
        <div className="sr-type-grid">
          {TYPES.map((t) => (
            <button key={t.value} type="button" className="sr-type-card" aria-pressed={type === t.value} onClick={() => setType(t.value)}>
              <b>{t.label}</b><span>{t.note}</span>
            </button>
          ))}
        </div>
      )}

      <h3 className="sr-form-section">Details</h3>
      <div className="sr-form-grid">
        <Field label="Design name" wide><input className="sr-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="SKU" hint={isEdit ? "SKUs are printed on tags, so they never change." : "The next free number."}>
          <input className="sr-input" value={sku} disabled />
        </Field>
        <Field label="Price (₹)"><input className="sr-input is-num" type="number" min="1" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} /></Field>
        <Field label="Listed for" hint="Which stores' sales associates see this design. Factory One hides it from every store.">
          <select className="sr-select" value={storeCategory} onChange={(e) => setStoreCategory(e.target.value)}>
            {STORE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Image link" wide hint="A Shopify CDN link works best.">
          <input className="sr-input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://cdn.shopify.com/…" />
        </Field>
      </div>

      <h3 className="sr-form-section">Options shown in the order form</h3>
      <div className="sr-form-grid">
        <Field label="Top options" hint="Type and press Enter."><ChipsInput id="sr-tops" value={tops} onChange={setTops} suggestions={options.tops} placeholder="Kurta, Choga…" /></Field>
        <Field label="Bottom options" hint="Type and press Enter."><ChipsInput id="sr-bottoms" value={bottoms} onChange={setBottoms} suggestions={options.bottoms} placeholder="Salwar, Dhoti…" /></Field>
        <Field label="Default top">
          <select className="sr-select" value={defaultTop} onChange={(e) => setDefaultTop(e.target.value)}>
            <option value="">None</option>{tops.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Default bottom">
          <select className="sr-select" value={defaultBottom} onChange={(e) => setDefaultBottom(e.target.value)}>
            <option value="">None</option>{bottoms.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <Field label="Default colour">
          <SearchSelect label="Default colour" placeholder="None" value={defaultColor} onChange={setDefaultColor}
            options={[
              ...(defaultColor && !options.colors.some((c) => c.name === defaultColor) ? [{ value: defaultColor, label: `${defaultColor} (not in colour list)` }] : []),
              ...options.colors.map((c) => ({ value: c.name, label: c.name, hex: c.hex })),
            ]} />
        </Field>
        <Field label="Dupatta" hint="Adds a separate dupatta barcode to orders.">
          <span className="sr-choice-row">
            <button type="button" className="sr-choice" aria-pressed={!hasDupatta} onClick={() => setHasDupatta(false)}>No dupatta</button>
            <button type="button" className="sr-choice" aria-pressed={hasDupatta} onClick={() => setHasDupatta(true)}>Has dupatta</button>
          </span>
        </Field>
        {hasDupatta && (
          <Field label="Dupatta colour" hint="Empty uses the default colour.">
            <select className="sr-select" value={dupattaColor} onChange={(e) => setDupattaColor(e.target.value)}>
              <option value="">Same as default colour</option>
              {options.dupattaColors.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        )}
      </div>

      <h3 className="sr-form-section">Sizes and stock</h3>
      {type !== TYPE_LXRTS ? (
        <>
          <Field label="Sizes it is made in" hint="Above 6XL is made as a Custom size.">
            <span className="sr-choice-row">
              {LISTED_SIZES.map((s) => <button key={s} type="button" className="sr-choice" aria-pressed={sizes.includes(s)} onClick={() => toggleSize(s)}>{s}</button>)}
              <button type="button" className="sr-linkbtn" style={{ marginLeft: 6 }} onClick={() => setSizes(LISTED_SIZES)}>All sizes</button>
              <button type="button" className="sr-linkbtn" onClick={() => setSizes([])}>Clear</button>
            </span>
          </Field>
          {legacySizes.length > 0 && (
            <p className="sr-field-hint" style={{ marginTop: 8 }}>Also kept from before: {legacySizes.join(", ")}. Remove with Clear if no longer offered.</p>
          )}
          {type === TYPE_CUSTOM && (
            <div className="sr-form-grid" style={{ marginTop: 16 }}>
              <Field label="Pieces on hand" hint={isEdit ? `Change stock with the Stock actions (Receive or Recount) so it is recorded.${placedTotal ? ` ${formatUnits(placedTotal)} are placed in locations.` : ""}` : "They start as unassigned; place them in locations afterwards."}>
                <input className="sr-input is-num" type="number" min="0" value={inventory} onChange={(e) => setInventory(e.target.value)} disabled={isEdit} />
              </Field>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="sr-form-grid">
            <Field label="Shopify product ID" hint="The number from the product's Shopify admin link, or its full gid://shopify/Product/… ID." wide>
              <input className="sr-input" value={shopifyId} onChange={(e) => setShopifyId(e.target.value)} placeholder="8180913373373" />
            </Field>
          </div>
          <p className={`sr-callout ${SHOPIFY_SYNC_ON ? "is-info" : "is-warn"}`}>
            <Icon name="alert" width={1.8} />
            <span>
              Size names must match the Shopify variants exactly, or that size never syncs.{" "}
              {isEdit
                ? "Stock counts for existing sizes are changed with the Stock actions, not here."
                : SHOPIFY_SYNC_ON
                  ? "Shopify's current count is used for each size it recognises."
                  : "Shopify is not read from this environment, so the counts you enter are saved as they are."}
            </span>
          </p>
          {!isEdit ? (
            <div className="sr-size-grid">
              <div className="sr-size-row sr-label" aria-hidden="true"><span>Size</span><span>Price (₹)</span><span>Shopify variant ID</span><span style={{ textAlign: "right" }}>Pieces</span></div>
              {OFFERED_SIZES.map((size) => {
                const v = variantFor(size);
                return (
                  <div key={size} className={`sr-size-row${v ? "" : " is-off"}`}>
                    <button type="button" className="sr-choice" aria-pressed={!!v} onClick={() => toggleVariantSize(size)}>{size}</button>
                    <input className="sr-input is-num" type="number" min="1" disabled={!v} value={v?.price || ""} placeholder={basePrice || "Design price"}
                      onChange={(e) => updateVariant(v.key, { price: e.target.value })} aria-label={`${size} price`} />
                    <input className="sr-input" disabled={!v} value={v?.shopifyVariantId || ""} placeholder={v ? "gid://shopify/ProductVariant/…" : "Switch the size on"}
                      onChange={(e) => updateVariant(v.key, { shopifyVariantId: e.target.value })} aria-label={`${size} Shopify variant ID`} />
                    <input className="sr-input is-num" type="number" min="0" disabled={!v} value={v ? v.inventory : ""}
                      onChange={(e) => updateVariant(v.key, { inventory: e.target.value })} aria-label={`${size} pieces`} />
                  </div>
                );
              })}
            </div>
          ) : (
          <>
          <div className="sr-lines">
            <div className="sr-variant-head" aria-hidden="true"><span>Size</span><span>Price (₹)</span><span>Shopify variant ID</span><span style={{ textAlign: "right" }}>{isEdit ? "On hand" : "Pieces"}</span><span /></div>
            {variants.map((v) => {
              const placed = placedBySize[v.size] || 0;
              const lockedRemoval = !!v.id && (v.stock > 0 || placed > 0);
              return (
                <div className="sr-variant" key={v.key}>
                  <select className="sr-select" value={v.size} onChange={(e) => updateVariant(v.key, { size: e.target.value })} disabled={!!v.id} aria-label="Size">
                    <option value="">Size</option>
                    {(v.id && !OFFERED_SIZES.includes(v.size) ? [v.size] : []).concat(OFFERED_SIZES).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input className="sr-input is-num" type="number" min="1" value={v.price} placeholder={basePrice || "Design price"} onChange={(e) => updateVariant(v.key, { price: e.target.value })} aria-label="Price" />
                  <input className="sr-input" value={v.shopifyVariantId} placeholder="gid://shopify/ProductVariant/…" onChange={(e) => updateVariant(v.key, { shopifyVariantId: e.target.value })} aria-label="Shopify variant ID" />
                  <input className="sr-input is-num" type="number" min="0" value={v.inventory} disabled={!!v.id} onChange={(e) => updateVariant(v.key, { inventory: e.target.value })} aria-label="Pieces" />
                  <button type="button" className="sr-line-remove" aria-label="Remove size"
                    title={lockedRemoval ? "This size still holds stock — sell, move or recount it to zero first." : undefined}
                    disabled={variants.length === 1 || lockedRemoval} onClick={() => setVariants((vs) => vs.filter((x) => x.key !== v.key))}>×</button>
                </div>
              );
            })}
          </div>
          <button type="button" className="sr-btn" onClick={() => setVariants((vs) => [...vs, blankVariant()])} style={{ marginBottom: 18 }}>+ Add a size</button>
          </>
          )}
        </>
      )}

      {canPlaceOpening && openingSizes.length > 0 && (
        <>
          <h3 className="sr-form-section">Where the pieces are</h3>
          <p className="sr-card-sub">
            Optional. Split the opening pieces across stores and warehouses; whatever is not placed stays unassigned and can be placed later.
          </p>
          <div className="sr-scroller" style={{ marginBottom: 10 }}>
            <table className="sr-table sr-open-grid" style={{ "--sr-table-min": "0px" }}>
              <thead>
                <tr>
                  <th>Size</th>
                  {openingLocations.map((loc) => (
                    <th key={loc} className="c">
                      {ledger.locationsById[loc]?.name}
                      <button type="button" className="sr-line-remove" aria-label="Remove location" style={{ marginLeft: 4 }}
                        onClick={() => { setOpeningLocations((ls) => ls.filter((x) => x !== loc)); setOpening((o) => { const n = { ...o }; delete n[loc]; return n; }); }}>×</button>
                    </th>
                  ))}
                  <th className="n">Unassigned</th>
                </tr>
              </thead>
              <tbody>
                {openingSizes.map((size) => {
                  const rest = type === TYPE_LXRTS ? piecesFor(size) - placedOpening(size) : null;
                  return (
                    <tr key={size}>
                      <td>{size}{type === TYPE_LXRTS && <span className="sr-muted"> · {formatUnits(piecesFor(size))}</span>}</td>
                      {openingLocations.map((loc) => (
                        <td key={loc} className="c">
                          <input className="sr-input is-num" type="number" min="0" value={opening[loc]?.[size] || ""} placeholder="0"
                            onChange={(e) => setOpeningQty(loc, size, e.target.value)} aria-label={`${size} at ${ledger.locationsById[loc]?.name}`} />
                        </td>
                      ))}
                      <td className={`n tot${rest != null && rest < 0 ? " sr-neg" : ""}`}>{rest != null ? formatUnits(rest) : ""}</td>
                    </tr>
                  );
                })}
                {type === TYPE_CUSTOM && (
                  <tr className="sr-total">
                    <td>All sizes</td>
                    {openingLocations.map((loc) => <td key={loc} className="c">{formatUnits(openingSizes.reduce((a, s) => a + openingQty(loc, s), 0))}</td>)}
                    <td className={`n${(Number(inventory) || 0) - placedOpeningAll < 0 ? " sr-neg" : ""}`}>{formatUnits((Number(inventory) || 0) - placedOpeningAll)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {locationChoices.length > 0 && (
            <div style={{ maxWidth: 320, marginBottom: 18 }}>
              <SearchSelect options={locationChoices} value="" placeholder="+ Add a location" label="Add a location"
                onChange={(v) => v && setOpeningLocations((ls) => [...ls, v])} />
            </div>
          )}
        </>
      )}

      {ledger?.installed && (
        <>
          <h3 className="sr-form-section">Collections</h3>
          <div className="sr-choice-row" style={{ marginBottom: 10 }}>
            {collections.map((c) => (
              <button key={c.id} type="button" className="sr-choice" aria-pressed={collectionIds.includes(c.id)}
                onClick={() => setCollectionIds((ids) => (ids.includes(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id]))}>{c.name}</button>
            ))}
            {!collections.length && <span className="sr-muted">No collections yet.</span>}
          </div>
          <div style={{ display: "flex", gap: 8, maxWidth: 420 }}>
            <input className="sr-input" value={newCollection} onChange={(e) => setNewCollection(e.target.value)} placeholder="New collection name"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCollection(); } }} />
            <button type="button" className="sr-btn" onClick={addCollection} disabled={!newCollection.trim()}>Add</button>
          </div>
        </>
      )}
    </FormModal>
  );
}
