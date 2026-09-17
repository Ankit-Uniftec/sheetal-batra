import React, { useEffect, useMemo, useState } from "react";
import { FormModal } from "./StockRoomUi";
import { FormSection, PField, FieldRow, Combo, MultiSelect, Switch, Pills } from "./ProductFormUi";
import {
  loadProductFormOptions, loadProductForEdit, loadLiveProductNames, findShopifyIdUsers, fetchNextSku,
  createProduct, updateProduct, createCollection, setProductCollections, placeStock, newRequestId,
} from "./stockRoomData";
import { readShopifyStock } from "./stockRoomShopify";
import { checkDuplicateName, SIZE_OPTIONS } from "../../components/AddProduct/csvHelpers";
import { STORE_CATEGORIES, DEFAULT_STORE_CATEGORY } from "../../utils/storeCategory";
import { normalizeShopifyId } from "../../utils/shopifyInventory";
import {
  formatUnits, isInvalidCount, UNLIMITED_SENTINEL, TYPE_LXRTS, TYPE_CUSTOM, TYPE_MTO, TYPE_LABELS, productType,
} from "./stockRoomModel";

// ============================================================
// Stock Room — add or edit a product, laid out like the prototype's form:
// Details → Garment → Shopify (LXRTS) → Sizes and opening stock.
//
// Writes the same columns, the same way, as components/AddProduct/AddProduct.jsx,
// so the order form cannot tell where a product was created.
//
// What it deliberately does not do:
//   * change a product's type after creation (its stock would change meaning);
//   * change stock counts on an existing product — the Stock actions do that,
//     so every change is recorded as a movement;
//   * offer 7XL / 8XL: above 6XL is made as a Custom size.
// ============================================================

// Sizes that can be chosen. LXRTS size names must match Shopify's variants,
// which use XXL; made to order and custom pieces use 2XL.
const OFFERED_SIZES = SIZE_OPTIONS.filter((s) => s !== "7XL" && s !== "8XL");
const LISTED_SIZES = OFFERED_SIZES.filter((s) => s !== "XXL");
const DEFAULT_ON = ["XS", "S", "M", "L", "XL", "XXL", "2XL"];

const UNASSIGNED = ""; // the opening-stock column for units not yet in a location

const TYPE_OPTIONS = [
  { value: TYPE_LXRTS, label: "LXRTS (Shopify)" },
  { value: TYPE_MTO, label: "Made to Order" },
  { value: TYPE_CUSTOM, label: "Custom Piece" },
];
const YES_NO = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];

const blankSize = (on = false) => ({ on, vid: "", stock: {}, ids: [], onHand: 0, invalid: false });
const plural = (n, w) => `${formatUnits(n)} ${w}${Number(n) === 1 ? "" : "s"}`;

export default function ProductEditor({ productId, view, onClose, onDone }) {
  const isEdit = !!productId;
  const ledger = view.ledger;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [options, setOptions] = useState({ tops: [], bottoms: [], colors: [], dupattaColors: [] });
  const [liveNames, setLiveNames] = useState([]);
  const [original, setOriginal] = useState(null);

  const [type, setType] = useState(TYPE_LXRTS);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [storeCategory, setStoreCategory] = useState(DEFAULT_STORE_CATEGORY);
  const [collectionIds, setCollectionIds] = useState([]);
  const [extraCollections, setExtraCollections] = useState([]);
  const [tops, setTops] = useState([]);
  const [bottoms, setBottoms] = useState([]);
  const [defaultTop, setDefaultTop] = useState("");
  const [defaultBottom, setDefaultBottom] = useState("");
  const [defaultColor, setDefaultColor] = useState("");
  const [hasDupatta, setHasDupatta] = useState("yes");
  const [dupattaColor, setDupattaColor] = useState("");
  const [shopifyId, setShopifyId] = useState("");
  // { [size]: { on, vid, stock: { [column]: "qty" }, ids, onHand, invalid } }
  const [grid, setGrid] = useState(() => Object.fromEntries(OFFERED_SIZES.map((s) => [s, blankSize(DEFAULT_ON.includes(s))])));
  const [extraSizes, setExtraSizes] = useState([]); // sizes already on a product that are no longer offered
  const [columns, setColumns] = useState([UNASSIGNED]);
  const [pickingLocation, setPickingLocation] = useState(false);

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
        if (!isEdit) {
          const next = await fetchNextSku();
          if (alive) setSku(next);
          return;
        }
        const { product, variants } = await loadProductForEdit(productId);
        if (!alive) return;
        const t = productType(product);
        setOriginal({ product, variants });
        setType(t);
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
        setHasDupatta(product.has_dupatta ? "yes" : "no");
        setDupattaColor(product.default_dupatta_color || "");
        setShopifyId(product.shopify_product_id || "");
        setCollectionIds(ledger?.collectionsByProduct?.[productId] || []);

        const next = Object.fromEntries(OFFERED_SIZES.map((s) => [s, blankSize(false)]));
        const extras = [];
        const mark = (size) => {
          if (!next[size]) { next[size] = blankSize(false); extras.push(size); }
          return next[size];
        };
        if (t === TYPE_LXRTS) {
          // Several rows can hold one size; the fullest valid copy is the one shown and edited.
          const bySize = {};
          variants.forEach((v) => { (bySize[v.size] || (bySize[v.size] = [])).push(v); });
          Object.entries(bySize).forEach(([size, rows]) => {
            const sorted = [...rows].sort((a, b) => (isInvalidCount(a.inventory) - isInvalidCount(b.inventory)) || (b.inventory - a.inventory));
            const row = mark(size);
            row.on = true;
            row.ids = sorted.map((v) => v.id);
            row.vid = sorted[0].shopify_variant_id || "";
            row.onHand = isInvalidCount(sorted[0].inventory) ? 0 : sorted[0].inventory;
            row.invalid = isInvalidCount(sorted[0].inventory);
          });
        } else {
          (product.available_size || []).forEach((size) => { mark(size).on = true; });
        }
        setGrid(next);
        setExtraSizes(extras);
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

  // ---------- derived ----------
  const sizeList = [...(type === TYPE_LXRTS ? OFFERED_SIZES : LISTED_SIZES), ...extraSizes];
  const onSizes = sizeList.filter((s) => grid[s]?.on);
  const tracks = type !== TYPE_MTO;
  const showStock = tracks && !isEdit;
  const placement = isEdit ? ledger?.placementById?.[productId] : null;

  const collections = useMemo(() => [...(ledger?.collections || []), ...extraCollections], [ledger, extraCollections]);
  const colourHex = useMemo(() => Object.fromEntries(options.colors.map((c) => [c.name, c.hex || null])), [options.colors]);

  const qty = (size, col) => Number(grid[size]?.stock[col]) || 0;
  const rowTotal = (size) => columns.reduce((a, c) => a + qty(size, c), 0);
  const colTotal = (col) => onSizes.reduce((a, s) => a + qty(s, col), 0);
  const grandTotal = onSizes.reduce((a, s) => a + rowTotal(s), 0);

  // Other designs' Shopify IDs and variant IDs, for the clash checks.
  const otherShopifyUsers = (gid) => view.rows.filter((r) => r.id !== productId && r.product.shopify_product_id
    && normalizeShopifyId(r.product.shopify_product_id, "Product") === gid);
  const otherVariantIds = useMemo(() => {
    const set = new Set();
    Object.entries(view.variantsByProduct || {}).forEach(([pid, rows]) => {
      if (pid === productId) return;
      rows.forEach((v) => { if (v.shopify_variant_id) set.add(normalizeShopifyId(v.shopify_variant_id, "ProductVariant")); });
    });
    return set;
  }, [view.variantsByProduct, productId]);

  // An existing size that still holds or has placed stock can't be switched off.
  const lockedOff = (row, size) => isEdit && type === TYPE_LXRTS && row.ids.length > 0
    && (row.onHand > 0 || (placement?.placedBySize?.[size] || 0) > 0);

  const updateSize = (size, patch) => setGrid((g) => ({ ...g, [size]: { ...(g[size] || blankSize()), ...patch } }));
  const setAllSizes = (on) => setGrid((g) => {
    const next = { ...g };
    sizeList.forEach((s) => {
      const row = next[s] || blankSize();
      if (!on && lockedOff(row, s)) return;
      next[s] = { ...row, on };
    });
    return next;
  });
  const everyOn = sizeList.length > 0 && sizeList.every((s) => grid[s]?.on);

  const locationChoices = (ledger?.installed ? ledger.locations : [])
    .filter((l) => !columns.includes(l.id))
    .map((l) => ({ value: l.id, label: `${l.name} · ${l.kind === "store" ? "store" : "warehouse"}` }));
  const columnName = (c) => (c === UNASSIGNED ? "Unassigned" : ledger?.locationsById?.[c]?.name || "Location");

  // Made to order is cut on demand in any size, so a new one starts with every size on.
  const chooseType = (v) => {
    setType(v);
    setError("");
    if (!isEdit && v === TYPE_MTO) {
      setGrid((g) => ({ ...g, ...Object.fromEntries(LISTED_SIZES.map((s) => [s, { ...(g[s] || blankSize()), on: true }])) }));
    }
  };

  // Keep defaults inside their option lists.
  const changeTops = (next) => { setTops(next); if (defaultTop && !next.includes(defaultTop)) setDefaultTop(""); };
  const changeBottoms = (next) => { setBottoms(next); if (defaultBottom && !next.includes(defaultBottom)) setDefaultBottom(""); };

  const shopifyHelp = (() => {
    if (!shopifyId.trim()) return { text: "Checked against every existing design before saving." };
    const gid = normalizeShopifyId(shopifyId, "Product");
    if (!/^gid:\/\/shopify\/Product\/\d+$/.test(gid)) return { text: "Enter the number from Shopify, or its gid://shopify/Product/… form.", tone: "warn" };
    const clash = otherShopifyUsers(gid)[0];
    return clash
      ? { text: `Already used by “${clash.product.name}” — sync would write to whichever row it read first.`, tone: "crit" }
      : { text: "Not used by any other design.", tone: "ok" };
  })();

  // ---------- validation ----------
  const validate = () => {
    if (!name.trim()) return "Give the design a name.";
    const price = Number(basePrice);
    if (!basePrice || !Number.isFinite(price) || price <= 0) return "Enter a retail price.";
    if (!onSizes.length) return "Mark at least one size this design is made in.";
    if (defaultColor && options.colors.length && !options.colors.some((c) => c.name === defaultColor)) return "Choose the default colour from the list.";
    if (showStock) {
      for (const s of onSizes) {
        for (const c of columns) {
          const raw = grid[s].stock[c];
          if (raw !== undefined && raw !== "" && (!Number.isInteger(Number(raw)) || Number(raw) < 0)) return `Size ${s}: opening stock must be a whole number.`;
        }
      }
    }
    if (type === TYPE_LXRTS) {
      const gid = normalizeShopifyId(shopifyId, "Product");
      if (!shopifyId.trim()) return "An LXRTS design needs its Shopify product ID.";
      if (!/^gid:\/\/shopify\/Product\/\d+$/.test(gid)) return "Enter the Shopify product ID (the number from Shopify, or its gid://shopify/Product/… form).";
      const clash = otherShopifyUsers(gid)[0];
      if (clash) return `Shopify ID already belongs to “${clash.product.name}”. Two designs cannot share one ID — that is what breaks the sync.`;
      const seen = new Set();
      for (const s of onSizes) {
        const raw = grid[s].vid.trim();
        if (!raw) continue;
        const vid = normalizeShopifyId(raw, "ProductVariant");
        if (seen.has(vid) || otherVariantIds.has(vid)) return `Variant ID ${raw} is used twice. Each size needs its own variant ID.`;
        seen.add(vid);
      }
    }
    return null;
  };

  // ---------- save ----------
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
        has_dupatta: hasDupatta === "yes",
        default_dupatta_color: hasDupatta === "yes" ? (dupattaColor.trim() || defaultColor.trim() || null) : null,
      };
      const variantId = (s) => normalizeShopifyId(grid[s].vid, "ProductVariant") || null;

      let saved;
      if (!isEdit) {
        Object.assign(row, {
          sku_id: sku,
          sync_enabled: type === TYPE_LXRTS,
          is_custom_piece: type === TYPE_CUSTOM,
          shopify_product_id: gid,
          available_size: type === TYPE_LXRTS ? null : onSizes,
          inventory: type === TYPE_MTO ? UNLIMITED_SENTINEL : type === TYPE_CUSTOM ? grandTotal : 0,
        });
        const variantRows = type !== TYPE_LXRTS ? [] : async (newId) => {
          // With Shopify sync on, Shopify's own count wins, exactly as AddProduct does.
          const live = await readShopifyStock(newId);
          return onSizes.map((s) => ({
            size: s,
            price: Number(basePrice),
            inventory: live && live[s] !== undefined ? live[s] : rowTotal(s),
            shopify_variant_id: variantId(s),
          }));
        };
        saved = await createProduct(row, variantRows);
      } else {
        if (type === TYPE_LXRTS) row.shopify_product_id = gid;
        else row.available_size = onSizes;
        const changes = { updateVariants: [], addVariants: [], removeVariantIds: [] };
        if (type === TYPE_LXRTS) {
          sizeList.forEach((s) => {
            const r = grid[s];
            if (!r) return;
            if (r.ids.length && !r.on) changes.removeVariantIds.push(...r.ids);
            else if (r.ids.length && r.on) changes.updateVariants.push({ id: r.ids[0], shopify_variant_id: variantId(s) });
            else if (!r.ids.length && r.on) changes.addVariants.push({ size: s, inventory: 0, price: Number(basePrice), shopify_variant_id: variantId(s) });
          });
        }
        saved = await updateProduct(productId, row, changes);
      }

      if (ledger?.installed) {
        await setProductCollections(saved.id, collectionIds, isEdit ? (ledger.collectionsByProduct[productId] || []) : []);
      }

      // Opening stock in locations: the product exists now, so each location is
      // a normal placement. A failure leaves those pieces unassigned, never lost.
      let placedNote = "";
      let placeFailed = false;
      if (showStock && ledger?.installed) {
        let placedUnits = 0;
        for (const col of columns.filter((c) => c !== UNASSIGNED)) {
          const lines = onSizes.map((s) => ({ productId: saved.id, size: s, qty: qty(s, col) })).filter((l) => l.qty > 0);
          if (!lines.length) continue;
          try {
            await placeStock({ requestId: newRequestId(), locationId: col, lines, note: "Opening stock" });
            placedUnits += lines.reduce((a, l) => a + l.qty, 0);
          } catch (e) {
            placeFailed = true;
            placedNote += ` Could not place stock in ${columnName(col)}: ${e.message}`;
          }
        }
        if (placedUnits) placedNote = ` · ${plural(placedUnits, "unit")} placed in locations.${placedNote}`;
      }

      const renamed = dup.renameTo ? ` Saved as “${finalName}” because that name already exists for another store.` : "";
      const summary = isEdit
        ? `“${saved.name}” saved.`
        : `“${saved.name}” (${saved.sku_id}) created · ${plural(onSizes.length, "size")}${showStock ? (grandTotal ? ` · ${plural(grandTotal, "unit")} of opening stock` : " · no opening stock") : ""}`;
      onDone({ text: `${summary}${renamed}${placedNote}`, tone: placeFailed ? "crit" : renamed ? "warn" : "ok" });
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  const addCollection = async (typed) => {
    const n = (typed || "").trim();
    if (!n) { setError("Type a collection name, then choose Create Collection."); return; }
    const existing = collections.find((c) => c.name.toLowerCase() === n.toLowerCase());
    try {
      const c = existing || await createCollection(n);
      if (!existing) setExtraCollections((xs) => [...xs, c]);
      setCollectionIds((ids) => (ids.includes(c.id) ? ids : [...ids, c.id]));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };

  const title = isEdit ? `Edit ${original?.product?.name || "Product"}` : "Add Product";
  const submitLabel = isEdit ? "Save Product" : "Create Product";

  if (loading || loadError) {
    return (
      <FormModal title={title} onClose={onClose} onSubmit={() => {}} submitLabel={submitLabel} disabled error={loadError} width={1280} submitInHead>
        {!loadError && <div className="sr-state-box" style={{ margin: "30px auto" }}><span className="sr-spinner" /><span className="sr-muted">Loading…</span></div>}
      </FormModal>
    );
  }

  // ---------- sizes ----------
  const selectAllLink = (
    <button type="button" className="sr-linkbtn" onClick={() => setAllSizes(!everyOn)}>{everyOn ? "Clear All" : "Select All"}</button>
  );

  const sizesHelp = [
    `${onSizes.length} of ${sizeList.length} sizes selected`,
    !tracks ? "no stock is held against a Made to Order design."
      : isEdit ? "stock is changed with the Stock actions (Receive, Recount), so every change is recorded."
      : grandTotal ? `${plural(grandTotal, "unit")} of opening stock` : "no opening stock",
    type === TYPE_LXRTS ? "a size with no variant ID never syncs to Shopify." : null,
  ].filter(Boolean).join(" · ");

  const removeColumn = (c) => {
    setColumns((cs) => cs.filter((x) => x !== c));
    setGrid((g) => Object.fromEntries(Object.entries(g).map(([s, r]) => {
      const stock = { ...r.stock };
      delete stock[c];
      return [s, { ...r, stock }];
    })));
  };

  const addLocationControl = showStock && ledger?.installed && locationChoices.length > 0 && (pickingLocation ? (
    <div className="sr-loc-picker">
      <Combo options={locationChoices} value={undefined} clearOnPick placeholder="Which location?" ariaLabel="Add a location"
        onChange={(v) => { setColumns((cs) => [...cs, v]); setPickingLocation(false); }} />
      <button type="button" className="sr-linkbtn" onClick={() => setPickingLocation(false)}>Cancel</button>
    </div>
  ) : (
    <button type="button" className="sr-linkbtn" onClick={() => setPickingLocation(true)}>+ Add Location</button>
  ));

  const sizeGrid = !tracks ? (
    <PField label="Sizes" actions={selectAllLink} help={sizesHelp}>
      <Pills options={sizeList} values={onSizes} onToggle={(s) => updateSize(s, { on: !grid[s]?.on })} />
    </PField>
  ) : (
    <PField label="Sizes" help={sizesHelp} actions={addLocationControl}>
      <div className="sr-grid-scroll">
        <table className="sr-grid-table">
          <thead>
            <tr>
              <th><span className="sr-th-stack"><span>Size</span>{selectAllLink}</span></th>
              <th>Available</th>
              {type === TYPE_LXRTS && <th>Shopify Variant ID</th>}
              {isEdit && type === TYPE_LXRTS && <th className="n">On hand</th>}
              {showStock && columns.map((c) => (
                <th key={c || "unassigned"} className="n">
                  {columnName(c)}
                  {c !== UNASSIGNED && (
                    <button type="button" className="sr-th-x" aria-label={`Remove ${columnName(c)}`} onClick={() => removeColumn(c)}>×</button>
                  )}
                </th>
              ))}
              {showStock && <th className="n">Total</th>}
            </tr>
          </thead>
          <tbody>
            {sizeList.map((s) => {
              const r = grid[s] || blankSize();
              const locked = lockedOff(r, s);
              return (
                <tr key={s} className={r.on ? undefined : "is-off"}>
                  <td className="sr-g-size">{s}</td>
                  <td>
                    <Switch on={r.on} label={`Size ${s} ${r.on ? "available" : "not available"}`}
                      disabled={r.on && locked}
                      title={r.on && locked ? "This size still holds stock — sell, move or recount it to zero first." : undefined}
                      onChange={(on) => updateSize(s, { on })} />
                  </td>
                  {type === TYPE_LXRTS && (
                    <td>
                      <input className="sr-input" type="text" value={r.vid} placeholder="4471920038" disabled={!r.on}
                        onChange={(e) => updateSize(s, { vid: e.target.value })} aria-label={`Size ${s} Shopify variant ID`} />
                    </td>
                  )}
                  {isEdit && type === TYPE_LXRTS && (
                    <td className="n sr-g-tot">
                      {!r.ids.length ? "—" : r.invalid ? <span className="sr-cell-invalid" title="Impossible count — recount it">!</span> : formatUnits(r.onHand)}
                      {r.ids.length > 1 && <span className="sr-muted" style={{ fontWeight: 400 }}> · {r.ids.length} copies</span>}
                    </td>
                  )}
                  {showStock && columns.map((c) => (
                    <td key={c || "unassigned"} className="n">
                      <input className="sr-input is-num" type="number" min="0" placeholder="0" disabled={!r.on}
                        value={r.stock[c] ?? ""} aria-label={`Size ${s} at ${columnName(c)}`}
                        onChange={(e) => updateSize(s, { stock: { ...r.stock, [c]: e.target.value } })} />
                    </td>
                  ))}
                  {showStock && <td className="n sr-g-tot">{r.on ? formatUnits(rowTotal(s)) : "—"}</td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td>{plural(onSizes.length, "size")}</td>
              {type === TYPE_LXRTS && <td />}
              {isEdit && type === TYPE_LXRTS && <td className="n">{formatUnits(onSizes.reduce((a, s) => a + (grid[s].onHand || 0), 0))}</td>}
              {showStock && columns.map((c) => <td key={c || "unassigned"} className="n">{formatUnits(colTotal(c))}</td>)}
              {showStock && <td className="n">{formatUnits(grandTotal)}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
    </PField>
  );

  const sizesSectionNote = type === TYPE_MTO
    ? "Made to Order designs are cut on demand, so no stock is held against them — just mark the sizes offered."
    : isEdit
      ? "Mark the sizes this design is made in. Stock is changed with the Stock actions so each change is recorded."
      : type === TYPE_LXRTS
        ? "Mark the sizes this design is made in, give each its Shopify variant ID, and enter stock per location."
        : "Mark the sizes this design is made in and enter opening stock per location.";

  const colourOptions = [
    { value: "", label: "None", hex: null },
    ...(defaultColor && !options.colors.some((c) => c.name === defaultColor) ? [{ value: defaultColor, label: `${defaultColor} (not in colour list)`, hex: null }] : []),
    ...options.colors.map((c) => ({ value: c.name, label: c.name, hex: c.hex || null })),
  ];

  return (
    <FormModal title={title} onClose={onClose} onSubmit={save} submitLabel={submitLabel} submitting={submitting} error={error}
      width={1280} submitInHead
      sub={isEdit ? `${sku} · ${TYPE_LABELS[type]}` : "Details, garment make-up, Shopify variants and opening stock in one pass."}>

      <FormSection title="Details" />
      <FieldRow>
        <PField label="Product Type" htmlFor="pf-type" help={isEdit ? "A product's type can't be changed after it is created." : null}>
          <Combo id="pf-type" options={TYPE_OPTIONS} value={type} disabled={isEdit} onChange={chooseType} />
        </PField>
        <PField label="Design Name" htmlFor="pf-name">
          <input id="pf-name" className="sr-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Hafsa - Burnt Orange Chauga with Salwar" />
        </PField>
      </FieldRow>
      {ledger?.installed && (
        <MultiSelect id="pf-collections" label="Collection Name" placeholder="Search collections"
          options={collections.map((c) => ({ value: c.id, label: c.name }))}
          values={collectionIds} onChange={setCollectionIds}
          createLabel="Create Collection" onCreate={addCollection}
          help="A design can belong to several collections." />
      )}
      <FieldRow>
        <PField label="SKU Code" htmlFor="pf-sku" help={isEdit ? "SKUs are printed on tags, so they never change." : "Generated as the next free SKU-NNNN."}>
          <input id="pf-sku" className="sr-input" value={sku} placeholder="Assigned on save" disabled />
        </PField>
        <PField label="Retail Price (₹)" htmlFor="pf-price">
          <input id="pf-price" className="sr-input" type="number" min="1" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} placeholder="185000" />
        </PField>
      </FieldRow>
      <FieldRow>
        <PField label="Listed For" htmlFor="pf-store" help="Which stores' associates see this design. Factory One hides it from every store.">
          <Combo id="pf-store" options={STORE_CATEGORIES.map((c) => ({ value: c, label: c }))} value={storeCategory} onChange={setStoreCategory} />
        </PField>
        <PField label="Image URL (from Shopify)" htmlFor="pf-image">
          <input id="pf-image" className="sr-input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://cdn.shopify.com/…" />
        </PField>
      </FieldRow>

      <FormSection title="Garment" />
      <MultiSelect id="pf-tops" label="Top Options" selectAll placeholder="Search top options"
        options={[...new Set([...options.tops, ...tops])].map((o) => ({ value: o, label: o }))}
        values={tops} onChange={changeTops}
        createLabel="Add top option" onCreate={(t) => { if (t && !tops.includes(t)) changeTops([...tops, t]); }} />
      <MultiSelect id="pf-bottoms" label="Bottom Options" selectAll placeholder="Search bottom options"
        options={[...new Set([...options.bottoms, ...bottoms])].map((o) => ({ value: o, label: o }))}
        values={bottoms} onChange={changeBottoms}
        createLabel="Add bottom option" onCreate={(t) => { if (t && !bottoms.includes(t)) changeBottoms([...bottoms, t]); }} />
      <FieldRow three>
        <PField label="Default Top" htmlFor="pf-dtop" help={tops.length ? "From the top options above." : "Pick top options first."}>
          <Combo id="pf-dtop" options={[{ value: "", label: "None" }, ...tops.map((o) => ({ value: o, label: o }))]} value={defaultTop} onChange={setDefaultTop} />
        </PField>
        <PField label="Default Bottom" htmlFor="pf-dbottom" help={bottoms.length ? "From the bottom options above." : "Pick bottom options first."}>
          <Combo id="pf-dbottom" options={[{ value: "", label: "None" }, ...bottoms.map((o) => ({ value: o, label: o }))]} value={defaultBottom} onChange={setDefaultBottom} />
        </PField>
        <PField label="Default Colour" htmlFor="pf-dcolour">
          <Combo id="pf-dcolour" options={colourOptions} value={defaultColor} onChange={setDefaultColor} />
        </PField>
      </FieldRow>
      <FieldRow>
        <PField label="Dupatta" htmlFor="pf-dupatta" help="Adds a separate dupatta barcode to orders.">
          <Combo id="pf-dupatta" options={YES_NO} value={hasDupatta} onChange={setHasDupatta} />
        </PField>
        {hasDupatta === "yes" ? (
          <PField label="Default Dupatta Colour" htmlFor="pf-dcol" help="Dupattas keep their own colour list.">
            <Combo id="pf-dcol" value={dupattaColor} onChange={setDupattaColor}
              options={[{ value: "", label: "Falls back to the default colour" },
                ...options.dupattaColors.map((c) => ({ value: c, label: c, hex: colourHex[c] ?? null }))]} />
          </PField>
        ) : <div />}
      </FieldRow>

      {type === TYPE_LXRTS && (
        <>
          <FormSection title="Shopify" note="The product ID identifies the design; a variant ID identifies one size of it." />
          <PField label="Shopify Product ID" htmlFor="pf-shopify" help={shopifyHelp.text} helpTone={shopifyHelp.tone}>
            <input id="pf-shopify" className="sr-input" value={shopifyId} onChange={(e) => setShopifyId(e.target.value)} placeholder="8342119447" />
          </PField>
        </>
      )}

      <FormSection title={type === TYPE_MTO || isEdit ? "Sizes" : "Sizes and Opening Stock"} note={sizesSectionNote} />
      {sizeGrid}
      {showStock && !ledger?.installed && (
        <p className="sr-help">Location tracking isn't set up on this database, so all opening stock is recorded as unassigned.</p>
      )}
    </FormModal>
  );
}
