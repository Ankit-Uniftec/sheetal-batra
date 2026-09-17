import React, { useMemo, useState } from "react";
import {
  Topline, SearchField, FilterButton, FilterDrawer, Facet, ActiveFilters, ProductCell, StockBadge, usePaged, SizeSummary,
  Icon, SearchSelect,
} from "./StockRoomUi";
import { formatUnits, formatInr, sizeLabel, SIZE_SCALE, CUSTOM_SIZE, TYPE_LABELS, TYPE_LXRTS, TYPE_CUSTOM, TYPE_MTO } from "./stockRoomModel";
import { loadProductsForExport } from "./stockRoomData";
import { CSV_COLUMNS, buildCsv, downloadCsv } from "../../components/AddProduct/csvHelpers";

// The Shopify ID moved into the product's detail view: a 34-character GID in
// every row pushed the useful columns off-screen on anything but a wide monitor.

const TYPE_OPTIONS = [
  { value: TYPE_LXRTS, label: "LXRTS" },
  { value: TYPE_CUSTOM, label: "Custom piece" },
  { value: TYPE_MTO, label: "Made to order" },
];

const STATUS_OPTIONS = [
  { value: "ok", label: "In stock" },
  { value: "low", label: "Low stock" },
  { value: "out", label: "Out of stock" },
  { value: "unlimited", label: "Unlimited" },
  { value: "untracked", label: "Not tracked" },
];

const YES_NO = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
const SIZE_FILTER = [...SIZE_SCALE, CUSTOM_SIZE].map((s) => ({ value: s, label: s }));
const DATA_STATES = [
  { value: "dupShopify", label: "Shares a Shopify ID" },
  { value: "noVariants", label: "LXRTS with no sizes in stock records" },
  { value: "noSizes", label: "No sizes listed" },
  { value: "noCollection", label: "In no collection" },
];

export default function ProductsScreen({ view, openProduct, canEditProducts, openEditor, openImport }) {
  const ledger = view.ledger;
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [type, setType] = useState("");
  const [store, setStore] = useState("");
  const [status, setStatus] = useState("");
  const [collection, setCollection] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [heldAt, setHeldAt] = useState("");
  const [hasStock, setHasStock] = useState("");
  const [dupatta, setDupatta] = useState("");
  const [dataState, setDataState] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const storeOptions = useMemo(() => Array.from(new Set(view.rows.map((r) => (r.product.store_category || "").trim() || "All Stores")))
    .sort().map((s) => ({ value: s, label: s })), [view.rows]);

  const colorOptions = useMemo(() => Array.from(new Set(view.rows.map((r) => (r.product.default_color || "").trim()).filter(Boolean)))
    .sort().map((c) => ({ value: c, label: c })), [view.rows]);

  const flagged = useMemo(() => ({
    dupShopify: new Set(view.findings.duplicateShopifyIds.flatMap((d) => d.products.map((x) => x.id))),
    noVariants: new Set(view.findings.lxrtsWithoutVariants.map((x) => x.id)),
  }), [view.findings]);

  const q = search.trim().toLowerCase();
  const rows = useMemo(() => view.rows.filter((r) => {
    if (type && r.type !== type) return false;
    if (color && (r.product.default_color || "").trim() !== color) return false;
    if (size && !r.stock.sizes.some((s) => sizeLabel(s) === size)) return false;
    if (heldAt && !Object.values(ledger?.placementById?.[r.id]?.byLocation?.[heldAt] || {}).some((n) => n > 0)) return false;
    if (hasStock) {
      const has = r.stock.tracked && (r.stock.unlimited || r.stock.total > 0);
      if ((hasStock === "yes") !== has) return false;
    }
    if (dupatta && (dupatta === "yes") !== !!r.product.has_dupatta) return false;
    if (dataState === "dupShopify" && !flagged.dupShopify.has(r.id)) return false;
    if (dataState === "noVariants" && !flagged.noVariants.has(r.id)) return false;
    if (dataState === "noSizes" && r.stock.sizes.length) return false;
    if (dataState === "noCollection" && (ledger?.collectionsByProduct?.[r.id] || []).length) return false;
    if (store && ((r.product.store_category || "").trim() || "All Stores") !== store) return false;
    if (status && r.status !== status) return false;
    if (collection && !(ledger?.collectionsByProduct?.[r.id] || []).includes(collection)) return false;
    if (!q) return true;
    const p = r.product;
    return [p.name, p.sku_id, p.shopify_product_id].some((v) => String(v || "").toLowerCase().includes(q));
  }), [view.rows, type, store, status, collection, color, size, heldAt, hasStock, dupatta, dataState, flagged, ledger, q]);

  const filterKey = [type, store, status, collection, color, size, heldAt, hasStock, dupatta, dataState].join("|");
  const [visible, more] = usePaged(rows, 50, `${filterKey}|${q}`);
  const activeCount = [type, store, status, collection, color, size, heldAt, hasStock, dupatta, dataState].filter(Boolean).length;
  const clearAll = () => { setType(""); setStore(""); setStatus(""); setCollection(""); setColor(""); setSize(""); setHeldAt(""); setHasStock(""); setDupatta(""); setDataState(""); };
  const locationOptions = (ledger?.installed ? ledger.locations : []).map((l) => ({ value: l.id, label: l.name }));
  const dataStateOptions = DATA_STATES.filter((d) => d.value !== "noCollection" || ledger?.installed);
  const { totals } = view;

  // Every live product in the Add Product CSV columns, plus type and stock —
  // the same file the CSV import reads, so it can be edited and re-imported.
  const exportCsv = async () => {
    setExporting(true);
    setExportError("");
    try {
      const shown = new Set(rows.map((r) => r.id));
      const full = (await loadProductsForExport()).filter((p) => shown.has(p.id));
      const headers = [...CSV_COLUMNS, "type", "on_hand", "shopify_product_id"];
      const data = full.map((p) => {
        const r = view.rowsById[p.id];
        return {
          sku_id: p.sku_id, name: p.name, image_url: p.image_url, base_price: p.base_price,
          top_options: (p.top_options || []).join("|"), bottom_options: (p.bottom_options || []).join("|"),
          default_top: p.default_top, default_bottom: p.default_bottom, default_color: p.default_color,
          store_category: p.store_category, has_dupatta: p.has_dupatta ? "yes" : "no",
          default_dupatta_color: p.default_dupatta_color, is_custom_piece: p.is_custom_piece ? "yes" : "no",
          available_size: (p.available_size || []).join("|"),
          inventory: r?.type === TYPE_MTO || Number(p.inventory) >= 9999 ? "MTO" : p.inventory,
          type: r ? TYPE_LABELS[r.type] : "", on_hand: r?.stock.tracked && !r.stock.unlimited ? r.stock.total : "",
          shopify_product_id: p.shopify_product_id || "",
        };
      });
      downloadCsv(`products-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(headers, data));
    } catch (e) {
      setExportError(e.message);
    } finally {
      setExporting(false);
    }
  };

  const collectionOptions = (ledger?.collections || []).map((c) => ({ value: c.id, label: c.name }));

  return (
    <>
      <Topline title="Products"
        sub={`${formatUnits(totals.designs)} designs · ${formatUnits(totals.lxrts)} LXRTS · ${formatUnits(totals.custom)} custom pieces · ${formatUnits(totals.mto)} made to order`}>
        <button type="button" className="sr-btn" onClick={exportCsv} disabled={exporting || !rows.length}>
          <Icon name="download" width={1.7} />{exporting ? "Preparing…" : "Export CSV"}
        </button>
        {canEditProducts && (
          <>
            <button type="button" className="sr-btn" onClick={() => openImport("products")}><Icon name="upload" width={1.7} />Import CSV</button>
            <button type="button" className="sr-btn sr-btn-primary" onClick={() => openEditor(null)}><Icon name="plus" width={2} />Add product</button>
          </>
        )}
      </Topline>
      <div className="sr-body">
        {exportError && <p className="sr-error" style={{ marginBottom: 12 }}>{exportError}</p>}
        <div className="sr-card">
          <div className="sr-card-head">
            <h2>Catalogue</h2>
            <div className="sr-head-tools" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <SearchField value={search} onChange={setSearch} placeholder="Design, SKU or Shopify ID" label="Search products" />
              <FilterButton count={activeCount} onClick={() => setDrawer(true)} />
            </div>
          </div>
          <p className="sr-card-sub">Every live design. Open one for its full stock breakdown and Shopify ID.</p>          <ActiveFilters items={[
            { key: "type", label: "Type", value: type, display: TYPE_LABELS[type], onClear: () => setType("") },
            { key: "store", label: "Store", value: store, onClear: () => setStore("") },
            { key: "status", label: "Stock", value: status, display: STATUS_OPTIONS.find((s) => s.value === status)?.label, onClear: () => setStatus("") },
            { key: "collection", label: "Collection", value: collection, display: ledger?.collectionsById?.[collection]?.name, onClear: () => setCollection("") },
            { key: "color", label: "Colour", value: color, onClear: () => setColor("") },
            { key: "size", label: "Size", value: size, onClear: () => setSize("") },
            { key: "held", label: "Held at", value: heldAt, display: ledger?.locationsById?.[heldAt]?.name, onClear: () => setHeldAt("") },
            { key: "has", label: "Has stock", value: hasStock, display: hasStock === "yes" ? "Yes" : "No", onClear: () => setHasStock("") },
            { key: "dupatta", label: "Dupatta", value: dupatta, display: dupatta === "yes" ? "Yes" : "No", onClear: () => setDupatta("") },
            { key: "data", label: "Data", value: dataState, display: DATA_STATES.find((d) => d.value === dataState)?.label, onClear: () => setDataState("") },
          ]} />
          <div className="sr-scroller">
            <table className="sr-table sr-rtable" style={{ "--sr-table-min": "1000px" }}>
              <thead>
                <tr><th>Design</th><th>Type</th><th>Store</th><th className="n">On hand</th><th>Sizes</th><th className="n">Sold 90d</th><th className="n">Price</th><th>Status</th></tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const p = r.product;
                  const sid = String(p.shopify_product_id || "");
                  const typeCell = r.type === TYPE_LXRTS
                    ? <span title={sid || "No Shopify ID"}>LXRTS{!sid && <span className="sr-muted"> · no Shopify ID</span>}</span>
                    : TYPE_LABELS[r.type];
                  return (
                    <tr key={r.id} className="is-link" onClick={() => openProduct(r.id)}>
                      <td className="is-primary"><ProductCell product={p} /></td>
                      <td data-label="Type">{typeCell}</td>
                      <td data-label="Store" className="is-optional">{(p.store_category || "").trim() || "All Stores"}</td>
                      <td data-label="On hand" className="n">{!r.stock.tracked ? "—" : r.stock.unlimited ? "Unlimited" : formatUnits(r.stock.total)}</td>
                      <td data-label="Sizes" className="is-wide"><SizeSummary sizes={r.stock.sizes} stock={r.type === TYPE_LXRTS ? r.stock : null} /></td>
                      <td data-label="Sold 90d" className="n">{formatUnits(r.sold90)}</td>
                      <td data-label="Price" className="n is-optional">{r.price ? formatInr(r.price) : "—"}</td>
                      <td data-label="Status"><StockBadge status={r.status} /></td>
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={8} className="sr-empty">{q ? "Nothing matches that search." : "No designs match these filters."}</td></tr>}
              </tbody>
            </table>
          </div>
          {more}
        </div>
      </div>
      {drawer && (
        <FilterDrawer sub={`${formatUnits(rows.length)} of ${formatUnits(view.rows.length)} designs`} onClose={() => setDrawer(false)}
          onClear={clearAll}>
          <Facet label="Type" options={TYPE_OPTIONS} value={type} onChange={setType} />
          <Facet label="Store listing" options={storeOptions} value={store} onChange={setStore} />
          <Facet label="Stock" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
          <Facet label="Has stock" options={YES_NO} value={hasStock} onChange={setHasStock} />
          <Facet label="Size offered" options={SIZE_FILTER} value={size} onChange={setSize} />
          {locationOptions.length > 0 && (
            <div className="sr-facet">
              <span className="sr-label">Held at</span>
              <SearchSelect options={locationOptions} value={heldAt} onChange={setHeldAt} placeholder="Any location" label="Held at" />
            </div>
          )}
          <div className="sr-facet">
            <span className="sr-label">Colour</span>
            <SearchSelect options={colorOptions} value={color} onChange={setColor} placeholder="Any colour" label="Colour" />
          </div>
          <Facet label="Dupatta" options={YES_NO} value={dupatta} onChange={setDupatta} />
          <Facet label="Data to check" options={dataStateOptions} value={dataState} onChange={setDataState} />
          {collectionOptions.length > 0 && (
            <div className="sr-facet">
              <span className="sr-label">Collection</span>
              <SearchSelect options={collectionOptions} value={collection} onChange={setCollection} placeholder="Any collection" label="Collection" />
            </div>
          )}
        </FilterDrawer>
      )}
    </>
  );
}
